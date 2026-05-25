#!/usr/bin/env python3
"""
YOLO26s person detection on Khadas Electron (asnn) — production RTSP pipeline.

Preprocess:  RGB → tiered CLAHE (optional) → letterbox 640×640 → NPU tensor
Postprocess: 3-scale decode → refine → desk-aware NMS → map to frame → conf filter
Display:     green boxes only at or above --conf (default 0.34)

--json-stream  emit JSON lines compatible with the ASNN Detection Dashboard
               (frame, fps, inference_ms, detections[], jpeg base64)
               suppresses all other stdout and skips person_live.json writes.
"""

from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import Any

os.environ["PYTHONUNBUFFERED"] = "1"
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import cv2 as cv
import numpy as np
from asnn.api import asnn
from asnn.types import output_format

log = logging.getLogger("yolo26_rtsp")

# ── Model geometry (YOLO26s, reg_max=1, 84 ch / scale) ─────────────────────
GRID_SIZES = (20, 40, 80)
STRIDES = (32, 16, 8)
LISTSIZE = 84
NUM_CLS = 80
SCALE_CONF_MUL = (1.0, 0.92, 0.78)

INV_255 = 1.0 / 255.0
LETTERBOX_PAD = 114

# ── Production defaults ─────────────────────────────────────────────────────
DEFAULT_CONF = 0.34
DEFAULT_NMS = 0.56
DEFAULT_IMGSZ = (640, 640)

# Internal decode can be slightly below display conf in dark scenes (recall),
# then results are clipped to --conf before draw/count (no weak/yellow boxes).
DECODE_MARGIN_DARK = 0.06
DECODE_FLOOR = 0.26

MIN_BOX_AREA = 0.00008
MIN_BOX_W = 0.004
MIN_BOX_H = 0.006
MIN_ASPECT = 0.35
MAX_ASPECT = 5.5
VERT_NMS_SEP = 0.055

JPEG_QUALITY = 75   # overridden by --jpeg-quality

cv.setNumThreads(2)


@dataclass
class RuntimeState:
    img_w: int = 640
    img_h: int = 640
    prebuf: np.ndarray | None = None
    grid_caches: tuple = ()
    gamma_luts: dict = field(default_factory=dict)


@dataclass
class PreprocessConfig:
    enabled: bool = False
    clahe_clip: float = 2.4
    clahe_grid: int = 8
    gamma: float = 1.42
    luma_scale: float = 1.06
    dark_threshold: int = 100
    brightness_beta: int = 16
    max_boost: int = 48


@dataclass
class LetterboxMeta:
    ratio: float
    pad_x: int
    pad_y: int
    orig_w: int
    orig_h: int


RT = RuntimeState()
PP = PreprocessConfig()
_CLAHE = None


class GridCache:
    __slots__ = (
        "ax", "ay", "inv_w", "inv_h", "grid_h",
        "scale_conf_mul", "y_center_norm", "spatial_thresh",
    )

    def __init__(self, grid_h: int, grid_w: int, stride: int, img_w: int, img_h: int, scale_conf_mul: float):
        col = np.arange(grid_w, dtype=np.float32)
        row = np.arange(grid_h, dtype=np.float32)
        self.ax = (col + 0.5).reshape(1, grid_w)
        self.ay = (row + 0.5).reshape(grid_h, 1)
        self.inv_w = stride / float(img_w)
        self.inv_h = stride / float(img_h)
        self.grid_h = grid_h
        self.scale_conf_mul = float(scale_conf_mul)
        y = ((row + 0.5) * stride / float(img_h)).reshape(grid_h, 1)
        self.y_center_norm = y.astype(np.float32)
        self.spatial_thresh = self._build_spatial_scale(grid_h, y)

    @staticmethod
    def _build_spatial_scale(grid_h: int, y: np.ndarray) -> np.ndarray:
        t = np.ones((grid_h, 1), dtype=np.float32)
        t = np.where(y >= 0.46, t * 0.82, t)
        if grid_h >= 40:
            t = np.where(y <= 0.34, t * 0.88, t)
            mid = (y >= 0.18) & (y <= 0.42)
            t = np.where(mid, t * 0.90, t)
        return t


def init_runtime(img_w: int, img_h: int) -> None:
    RT.img_w, RT.img_h = int(img_w), int(img_h)
    RT.prebuf = np.empty((3, RT.img_h, RT.img_w), dtype=np.float32)
    RT.grid_caches = tuple(
        GridCache(g, g, s, RT.img_w, RT.img_h, m)
        for g, s, m in zip(GRID_SIZES, STRIDES, SCALE_CONF_MUL)
    )


# ── Utilities ───────────────────────────────────────────────────────────────

class FpsMeter:
    __slots__ = ("interval", "count", "fps", "t0")

    def __init__(self, interval: float = 0.5):
        self.interval = interval
        self.count = 0
        self.fps = 0.0
        self.t0 = time.perf_counter()

    def tick(self) -> float:
        self.count += 1
        elapsed = time.perf_counter() - self.t0
        if elapsed >= self.interval:
            self.fps = self.count / elapsed
            self.count = 0
            self.t0 = time.perf_counter()
        return self.fps


def sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -50.0, 50.0)))


def measure_brightness(rgb: np.ndarray) -> float:
    return float(np.mean(cv.cvtColor(rgb, cv.COLOR_RGB2GRAY)))


def to_rgb(frame: np.ndarray) -> np.ndarray:
    if frame is None:
        raise ValueError("empty frame")
    if frame.ndim == 2:
        return cv.cvtColor(frame, cv.COLOR_GRAY2RGB)
    if frame.shape[2] == 3:
        return cv.cvtColor(frame, cv.COLOR_BGR2RGB)
    if frame.shape[2] == 4:
        return cv.cvtColor(frame, cv.COLOR_BGRA2RGB)
    raise ValueError("unsupported channels: {}".format(frame.shape[2]))


def decode_confidence(display_conf: float, mean_l_in: float) -> float:
    if mean_l_in >= 100:
        return display_conf
    t = max(0.0, min(1.0, (100.0 - mean_l_in) / 50.0))
    return max(DECODE_FLOOR, display_conf - DECODE_MARGIN_DARK * t)


# ── Preprocess ──────────────────────────────────────────────────────────────

def _clahe(clip: float) -> cv.CLAHE:
    global _CLAHE
    if _CLAHE is None:
        _CLAHE = cv.createCLAHE(clipLimit=clip, tileGridSize=(PP.clahe_grid, PP.clahe_grid))
    return _CLAHE


def _gamma_lut(gamma: float) -> np.ndarray:
    key = round(gamma, 3)
    if key not in RT.gamma_luts:
        inv = 1.0 / gamma
        RT.gamma_luts[key] = (np.linspace(0, 1, 256) ** inv * 255).astype(np.uint8)
    return RT.gamma_luts[key]


def _cap_luma_rgb(rgb: np.ndarray, target: float) -> np.ndarray:
    mean_l = measure_brightness(rgb)
    if mean_l <= target + 2:
        return rgb
    lab = cv.cvtColor(rgb, cv.COLOR_RGB2LAB)
    l, a, b = cv.split(lab)
    l = np.clip(l.astype(np.float32) * (target / mean_l), 0, 255).astype(np.uint8)
    return cv.cvtColor(cv.merge([l, a, b]), cv.COLOR_LAB2RGB)


def enhance_rgb(rgb: np.ndarray) -> tuple[np.ndarray, float, float]:
    mean_in = measure_brightness(rgb)
    if mean_in >= 82:
        mode, clip, luma, gamma, boost_k = "contrast", 2.0, 1.02, 1.0, 0.0
    elif mean_in >= 48:
        mode, clip, luma, gamma, boost_k = "mild", 2.2, min(PP.luma_scale, 1.06), min(PP.gamma, 1.28), 0.5
    else:
        mode, clip, luma, gamma, boost_k = "full", PP.clahe_clip, PP.luma_scale, PP.gamma, 1.0

    lab = cv.cvtColor(rgb, cv.COLOR_RGB2LAB)
    l, a, b = cv.split(lab)
    l = _clahe(clip).apply(l)
    l = np.clip(l.astype(np.float32) * luma, 0, 255).astype(np.uint8)

    if boost_k > 0 and mean_in < PP.dark_threshold:
        boost = int(boost_k * min(PP.max_boost, (PP.dark_threshold - mean_in) * 0.4 + PP.brightness_beta * 0.5))
        if boost > 0:
            l = cv.add(l, boost)

    out = cv.cvtColor(cv.merge([l, a, b]), cv.COLOR_LAB2RGB)
    if mode == "full" and mean_in < 72:
        gamma = max(gamma, 1.42 + (72.0 - mean_in) * 0.003)
    if gamma > 1.0:
        out = cv.LUT(out, _gamma_lut(gamma))

    cap = 96.0 if mode == "contrast" else 94.0 if mode == "mild" else 90.0
    out = _cap_luma_rgb(out, cap)
    return out, mean_in, measure_brightness(out)


def letterbox(rgb: np.ndarray) -> tuple[np.ndarray, LetterboxMeta]:
    h, w = rgb.shape[:2]
    tw, th = RT.img_w, RT.img_h
    r = min(tw / w, th / h)
    nw, nh = max(1, int(round(w * r))), max(1, int(round(h * r)))
    resized = cv.resize(rgb, (nw, nh), interpolation=cv.INTER_LINEAR)
    pad_x, pad_y = (tw - nw) // 2, (th - nh) // 2
    out = np.full((th, tw, 3), LETTERBOX_PAD, dtype=np.uint8)
    out[pad_y : pad_y + nh, pad_x : pad_x + nw] = resized
    return out, LetterboxMeta(r, pad_x, pad_y, w, h)


def prepare_frame(bgr: np.ndarray) -> tuple[np.ndarray, float, float, np.ndarray, LetterboxMeta]:
    rgb = to_rgb(bgr)
    mean_in = measure_brightness(rgb)
    if PP.enabled:
        rgb, mean_in, mean_out = enhance_rgb(rgb)
    else:
        mean_out = mean_in
    lettered, meta = letterbox(rgb)
    np.copyto(RT.prebuf, lettered.astype(np.float32).transpose(2, 0, 1) * INV_255)
    return RT.prebuf, mean_in, mean_out, cv.cvtColor(rgb, cv.COLOR_RGB2BGR), meta


# ── Postprocess ─────────────────────────────────────────────────────────────

def decode_scale(raw: np.ndarray, cache: GridCache, conf_decode: float) -> tuple[np.ndarray, np.ndarray]:
    probs = sigmoid(raw[0])
    thresh = conf_decode * cache.scale_conf_mul * cache.spatial_thresh
    mask = probs >= thresh
    if not np.any(mask):
        return np.empty((0, 4), np.float32), np.empty(0, np.float32)

    l, t, r, b = raw[NUM_CLS : NUM_CLS + 4]
    x1 = (cache.ax - l) * cache.inv_w
    y1 = (cache.ay - t) * cache.inv_h
    x2 = (cache.ax + r) * cache.inv_w
    y2 = (cache.ay + b) * cache.inv_h
    boxes = np.stack((x1[mask], y1[mask], x2[mask], y2[mask]), axis=-1).astype(np.float32)
    return boxes, probs[mask].astype(np.float32)


def refine_boxes(boxes: np.ndarray, scores: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if boxes.size == 0:
        return boxes, scores
    w = boxes[:, 2] - boxes[:, 0]
    h = boxes[:, 3] - boxes[:, 1]
    ar = h / (w + 1e-6)
    ok = (
        (w > MIN_BOX_W)
        & (h > MIN_BOX_H)
        & (w * h > MIN_BOX_AREA)
        & (boxes[:, 2] > boxes[:, 0])
        & (boxes[:, 3] > boxes[:, 1])
        & (ar > MIN_ASPECT)
        & (ar < MAX_ASPECT)
    )
    return boxes[ok], scores[ok]


def nms_desk_aware(boxes: np.ndarray, scores: np.ndarray, iou_thresh: float) -> np.ndarray:
    if boxes.size == 0:
        return np.array([], dtype=np.int64)
    x1, y1, x2, y2 = boxes.T
    cy = (y1 + y2) * 0.5
    areas = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size:
        i = int(order[0])
        keep.append(i)
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(x1[i], x1[rest])
        yy1 = np.maximum(y1[i], y1[rest])
        xx2 = np.minimum(x2[i], x2[rest])
        yy2 = np.minimum(y2[i], y2[rest])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        ovr = inter / (areas[i] + areas[rest] - inter + 1e-6)
        dup = (ovr > iou_thresh) & (np.abs(cy[i] - cy[rest]) < VERT_NMS_SEP)
        order = rest[~dup]
    return np.array(keep, dtype=np.int64)


def suppress_nested(boxes: np.ndarray, scores: np.ndarray, min_score: float) -> tuple[np.ndarray, np.ndarray]:
    n = len(scores)
    if n < 2:
        return boxes, scores
    cy = (boxes[:, 1] + boxes[:, 3]) * 0.5
    order = scores.argsort()[::-1]
    keep = np.ones(n, dtype=bool)
    for ii, i in enumerate(order):
        if not keep[i] or scores[i] < min_score:
            continue
        for j in order[ii + 1 :]:
            if not keep[j] or scores[j] >= min_score:
                continue
            if abs(cy[i] - cy[j]) > 0.045:
                continue
            xx1, yy1 = max(boxes[i, 0], boxes[j, 0]), max(boxes[i, 1], boxes[j, 1])
            xx2, yy2 = min(boxes[i, 2], boxes[j, 2]), min(boxes[i, 3], boxes[j, 3])
            if xx2 <= xx1 or yy2 <= yy1:
                continue
            inter = (xx2 - xx1) * (yy2 - yy1)
            aj = (boxes[j, 2] - boxes[j, 0]) * (boxes[j, 3] - boxes[j, 1])
            ai = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
            if inter / (ai + aj - inter + 1e-6) > 0.38:
                keep[j] = False
    return boxes[keep], scores[keep]


def map_boxes_to_frame(boxes: np.ndarray, meta: LetterboxMeta) -> np.ndarray:
    tw, th = float(RT.img_w), float(RT.img_h)
    ow, oh = float(meta.orig_w), float(meta.orig_h)
    r, px, py = meta.ratio, float(meta.pad_x), float(meta.pad_y)
    out = boxes.copy()
    out[:, 0] = (boxes[:, 0] * tw - px) / r / ow
    out[:, 2] = (boxes[:, 2] * tw - px) / r / ow
    out[:, 1] = (boxes[:, 1] * th - py) / r / oh
    out[:, 3] = (boxes[:, 3] * th - py) / r / oh
    np.clip(out, 0.0, 1.0, out=out)
    return out


def postprocess(
    outputs: list[np.ndarray],
    conf_decode: float,
    conf_display: float,
    nms_thresh: float,
    meta: LetterboxMeta,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    boxes_list, scores_list = [], []
    for raw, cache in zip(outputs, RT.grid_caches):
        b, s = decode_scale(raw, cache, conf_decode)
        if b.size:
            boxes_list.append(b)
            scores_list.append(s)
    if not boxes_list:
        return None, None

    boxes = np.concatenate(boxes_list, axis=0)
    scores = np.concatenate(scores_list, axis=0)
    boxes, scores = refine_boxes(boxes, scores)
    if boxes.size == 0:
        return None, None

    keep = nms_desk_aware(boxes, scores, nms_thresh)
    boxes, scores = boxes[keep], scores[keep]
    boxes, scores = suppress_nested(boxes, scores, conf_display)
    boxes = map_boxes_to_frame(boxes, meta)

    ok = scores >= conf_display
    boxes, scores = boxes[ok], scores[ok]
    if boxes.size == 0:
        return None, None
    return boxes, scores


def parse_npu_output(arr: np.ndarray, grid_h: int, grid_w: int) -> np.ndarray:
    arr = np.asarray(arr, dtype=np.float32)
    expected = LISTSIZE * grid_h * grid_w
    if arr.ndim == 4:
        arr = arr[0]
    if arr.ndim == 3:
        if arr.shape[0] == LISTSIZE:
            return arr
        if arr.shape[-1] == LISTSIZE:
            return arr.transpose(2, 0, 1)
    if arr.size == expected:
        return arr.reshape(LISTSIZE, grid_h, grid_w)
    raise ValueError("unexpected asnn shape {} for {}x{}".format(arr.shape, grid_h, grid_w))


def run_inference(net: asnn, tensor: np.ndarray) -> list[np.ndarray]:
    data = net.nn_inference(
        [tensor],
        platform="ONNX",
        reorder="2 1 0",
        output_tensor=3,
        output_format=output_format.OUT_FORMAT_FLOAT32,
    )
    return [
        parse_npu_output(data[2], GRID_SIZES[0], GRID_SIZES[0]),
        parse_npu_output(data[1], GRID_SIZES[1], GRID_SIZES[1]),
        parse_npu_output(data[0], GRID_SIZES[2], GRID_SIZES[2]),
    ]


# ── JPEG encode (for --json-stream) ─────────────────────────────────────────

def encode_jpeg(bgr: np.ndarray, quality: int = JPEG_QUALITY) -> str | None:
    h, w = bgr.shape[:2]
    if w > 640:
        bgr = cv.resize(bgr, (640, int(h * 640 / w)))
    ok, buf = cv.imencode('.jpg', bgr, [cv.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        return None
    return base64.b64encode(buf).decode('utf-8')


# ── Format detections for JSON stream ───────────────────────────────────────

def format_dets_json(boxes: np.ndarray | None, scores: np.ndarray | None) -> list[dict]:
    if boxes is None or scores is None:
        return []
    dets = []
    for box, score in zip(boxes, scores):
        x1, y1, x2, y2 = (float(np.clip(v, 0, 1)) for v in box)
        dets.append({
            "class_id":   0,
            "class_name": "person",
            "score":      round(float(score), 4),
            "box":        [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)],
        })
    return dets


# ── RTSP capture ────────────────────────────────────────────────────────────

class LatestFrameReader:
    def __init__(self, url: str, transport: str = "tcp"):
        self.url = url
        self.transport = transport
        self._lock = threading.Lock()
        self._frame = None
        self._ok = False
        self._stamp = 0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._cap: cv.VideoCapture | None = None

    def _open(self) -> cv.VideoCapture:
        proto = "tcp" if self.transport == "tcp" else "udp"
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
            "rtsp_transport;{}|fflags;nobuffer|flags;low_delay|max_delay;0".format(proto)
        )
        cap = cv.VideoCapture(self.url, cv.CAP_FFMPEG)
        cap.set(cv.CAP_PROP_BUFFERSIZE, 1)
        return cap

    def start(self) -> bool:
        self._cap = self._open()
        if not self._cap.isOpened():
            return False
        self._thread = threading.Thread(target=self._loop, daemon=True, name="rtsp-reader")
        self._thread.start()
        return True

    def _loop(self) -> None:
        while not self._stop.is_set():
            if self._cap is None or not self._cap.isOpened():
                time.sleep(0.5)
                self._cap = self._open()
                continue
            ret, frame = self._cap.read()
            if not ret:
                time.sleep(0.2)
                if self._cap is not None:
                    self._cap.release()
                self._cap = self._open()
                continue
            with self._lock:
                self._frame = frame
                self._ok = True
                self._stamp += 1

    def get_copy(self) -> tuple[bool, np.ndarray | None, int]:
        with self._lock:
            if not self._ok or self._frame is None:
                return False, None, 0
            return True, self._frame.copy(), self._stamp

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        if self._cap is not None:
            self._cap.release()


# ── UI / logging (non-stream mode only) ─────────────────────────────────────

def draw_overlay(frame: np.ndarray, boxes: np.ndarray, scores: np.ndarray) -> None:
    h, w = frame.shape[:2]
    for box, score in zip(boxes, scores):
        x1, y1, x2, y2 = box
        left, top = max(0, int(x1 * w)), max(0, int(y1 * h))
        right, bottom = min(w, int(x2 * w)), min(h, int(y2 * h))
        cv.rectangle(frame, (left, top), (right, bottom), (0, 255, 0), 2)
        cv.putText(
            frame,
            "person {:.2f}".format(float(score)),
            (left, max(0, top - 4)),
            cv.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 0, 255),
            1,
            cv.LINE_AA,
        )


def draw_hud(
    frame: np.ndarray,
    n_person: int,
    cam_fps: float,
    npu_fps: float,
    latency_ms: float,
    conf: float,
    mean_in: float,
    mean_out: float,
) -> None:
    tag = " | LOW-LIGHT" if PP.enabled else ""
    cv.putText(
        frame,
        "pers {} | cam {:.0f} | npu {:.0f} | {:.0f}ms | conf {:.2f} | in~{:.0f} out~{:.0f}{}".format(
            n_person, cam_fps, npu_fps, latency_ms, conf, mean_in, mean_out, tag
        ),
        (8, 24),
        cv.FONT_HERSHEY_SIMPLEX,
        0.55,
        (0, 255, 255),
        2,
        cv.LINE_AA,
    )


def print_status(
    n_person: int,
    cam_fps: float,
    npu_fps: float,
    latency_ms: float,
    conf: float,
    mean_in: float,
    mean_out: float,
    json_stream: bool,
) -> None:
    if json_stream:
        return   # stdout is reserved for JSON lines
    line = (
        "[RTSP] persons={n} | cam_fps={cam:.1f} | npu_fps={npu:.1f} | {ms:.0f}ms | "
        "conf={cf:.2f} | in~{i:.0f} out~{o:.0f}{ll}"
    ).format(
        n=n_person, cam=cam_fps, npu=npu_fps, ms=latency_ms,
        cf=conf, i=mean_in, o=mean_out, ll=" | low-light" if PP.enabled else "",
    )
    if sys.stdout.isatty():
        sys.stdout.write("\r\033[K" + line)
    else:
        print(line)
    sys.stdout.flush()


# ── CLI ─────────────────────────────────────────────────────────────────────

def parse_imgsz(values: list[int]) -> tuple[int, int]:
    if len(values) == 1:
        return values[0], values[0]
    if len(values) == 2:
        return values[0], values[1]
    sys.exit("--imgsz: one value (square) or two: W H")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="YOLO26s asnn RTSP person detector (production)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--library",      required=True,  help="libnn_yolo26s.so path")
    p.add_argument("--model",        required=True,  help="yolo26s.nb path")
    p.add_argument("--rtsp",         required=True,  help="RTSP URL  (or pass --type/--device via server)")
    p.add_argument("--transport",    default="tcp",  choices=["tcp", "udp"])
    p.add_argument("--level",        default="0",    help="asnn performance level")
    p.add_argument("--conf",         type=float,     default=DEFAULT_CONF)
    p.add_argument("--nms",          type=float,     default=DEFAULT_NMS)
    p.add_argument("--imgsz",        type=int, nargs="+", default=list(DEFAULT_IMGSZ), metavar="N")
    p.add_argument("--width",        type=int,       default=960,  help="Preview width (0=native, headless only)")
    p.add_argument("--headless",     action="store_true")
    p.add_argument("--no-display",   action="store_true")
    p.add_argument("--low-light",    action="store_true")
    p.add_argument("--log-level",    default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    p.add_argument("--json-stream",  action="store_true",
                   help="Emit dashboard-compatible JSON lines on stdout (suppresses all other output)")
    p.add_argument("--jpeg-quality", type=int, default=75,
                   help="JPEG quality for --json-stream frames (10-95)")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    # In json-stream mode redirect logging to stderr so stdout stays clean
    log_stream = sys.stderr if args.json_stream else sys.stdout
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(levelname)s %(message)s",
        stream=log_stream,
    )

    if not os.path.isfile(args.model):
        sys.exit("model not found: {}".format(args.model))
    if not os.path.isfile(args.library):
        sys.exit("library not found: {}".format(args.library))

    conf = max(0.05, min(0.95, args.conf))
    nms  = max(0.3,  min(0.9,  args.nms))
    img_w, img_h = parse_imgsz(args.imgsz)
    init_runtime(img_w, img_h)

    global JPEG_QUALITY
    JPEG_QUALITY = max(10, min(95, args.jpeg_quality))

    PP.enabled = args.low_light
    global _CLAHE
    _CLAHE = None

    level    = int(args.level) if args.level in ("1", "2") else 0
    headless = args.headless or args.no_display or args.json_stream
    json_stream = args.json_stream

    def jlog(level: str, message: str) -> None:
        """Emit a log JSON line on stdout (json-stream mode only)."""
        if json_stream:
            print(json.dumps({"type": "log", "level": level, "message": message}), flush=True)

    jlog("info", "asnn init conf={:.2f} nms={:.2f} size={}x{} low_light={} json_stream={}".format(
        conf, nms, img_w, img_h, PP.enabled, json_stream))

    net = asnn("Electron")
    net.nn_init(library=args.library, model=args.model, level=level)
    jlog("info", "Neural network ready")

    reader = LatestFrameReader(args.rtsp, args.transport)
    if not reader.start():
        msg = "cannot open RTSP: {}".format(args.rtsp)
        if json_stream:
            print(json.dumps({"type": "log", "level": "err", "message": msg}), flush=True)
        sys.exit(msg)

    jlog("info", "Capture started — rtsp={}".format(args.rtsp))

    win = "YOLO26 Person RTSP"
    if not headless:
        cv.namedWindow(win, cv.WINDOW_NORMAL)

    cam_fps_m, npu_fps_m = FpsMeter(), FpsMeter()
    cam_fps = npu_fps = 0.0
    last_stamp = -1
    frame_num  = 0
    fps_val    = 0.0

    try:
        while True:
            ok, frame, stamp = reader.get_copy()
            if not ok or frame is None:
                time.sleep(0.005)
                continue
            if stamp != last_stamp:
                cam_fps = cam_fps_m.tick()
                last_stamp = stamp

            tensor, mean_in, mean_out, preview, meta = prepare_frame(frame)
            conf_decode = decode_confidence(conf, mean_in)

            t0 = time.perf_counter()
            outputs = run_inference(net, tensor)
            boxes, scores = postprocess(outputs, conf_decode, conf, nms, meta)
            latency_ms = (time.perf_counter() - t0) * 1000.0
            npu_fps = npu_fps_m.tick()
            frame_num += 1

            n_person = 0 if boxes is None else len(boxes)

            if json_stream:
                dets = format_dets_json(boxes, scores)
                jpeg = encode_jpeg(frame, JPEG_QUALITY)   # encode original frame
                print(json.dumps({
                    "frame":        frame_num,
                    "fps":          round(npu_fps, 2),
                    "inference_ms": round(latency_ms, 2),
                    "detections":   dets,
                    "jpeg":         jpeg,
                }), flush=True)
            else:
                print_status(n_person, cam_fps, npu_fps, latency_ms, conf, mean_in, mean_out, json_stream)

            if not headless:
                show = preview
                if boxes is not None:
                    draw_overlay(show, boxes, scores)
                draw_hud(show, n_person, cam_fps, npu_fps, latency_ms, conf, mean_in, mean_out)
                if args.width > 0:
                    h, w = show.shape[:2]
                    if w != args.width:
                        show = cv.resize(show, (args.width, int(h * args.width / w)), interpolation=cv.INTER_LINEAR)
                cv.imshow(win, show)
                if cv.waitKey(1) & 0xFF == ord("q"):
                    break

    except KeyboardInterrupt:
        log.info("stopped by user")
    finally:
        print("", file=sys.stderr, flush=True)
        reader.stop()
        if not headless:
            cv.destroyAllWindows()


if __name__ == "__main__":
    init_runtime(*DEFAULT_IMGSZ)
    main()
