#!/usr/bin/env python3
"""
shared_stream.py — Single-source RTSP Frame Broker

IMPORTANT: os.environ MUST be set before cv2 is imported anywhere in the
process. This file sets them at the very top. Always import shared_stream
BEFORE cv2 in any file that uses it.

Opens each RTSP camera ONCE and fans frames out to:
  1. fire_queue   → fire detection workers
  2. person_queue → person detection workers
  3. FFmpeg stdin → MediaMTX RTSP re-publish (dashboard stream)
"""

# ── env vars FIRST — before ANY cv2 import ───────────────
import os
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
    "rtsp_transport;tcp"
    "|fflags;nobuffer+discardcorrupt"
    "|flags;low_delay"
    "|analyzeduration;1000000"
    "|probesize;1000000"
    "|stimeout;10000000"
    "|tcp_nodelay;1"
    "|reconnect;1"
    "|reconnect_streamed;1"
    "|reconnect_delay_max;5"
)
os.environ.setdefault("QT_QPA_PLATFORM", "xcb")

# ── now safe to import cv2 ────────────────────────────────
import cv2
import time
import queue
import threading
import subprocess
import numpy as np
from typing import Dict, Optional

# ─── CONFIG ────────────────────────────────────────────────
CAMERAS = [
    {"id": "cam1", "rtsp": "rtsp://admin:Admin@123@10.30.41.161:554/profile2/media.smp"},
    {"id": "cam2", "rtsp": "rtsp://admin:Admin@123@10.30.41.142:554/profile2/media.smp"},
]

MEDIAMTX_HOST = "localhost"
MEDIAMTX_PORT = 8554          # MediaMTX RTSP publish port

FRAME_WIDTH   = 640
FRAME_HEIGHT  = 480
TARGET_FPS    = 15

QUEUE_MAXSIZE = 4             # frames buffered per consumer


# ──────────────────────────────────────────────────────────
def _test_rtsp(url: str, timeout: float = 10.0) -> bool:
    """Quick connectivity check using ffprobe before opening VideoCapture."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-rtsp_transport", "tcp",
                "-i", url,
                "-show_entries", "stream=width,height,codec_name",
                "-of", "default=noprint_wrappers=1",
            ],
            timeout=timeout,
            capture_output=True,
        )
        ok = result.returncode == 0
        if not ok:
            print(f"[ffprobe] {url}\n  stderr: {result.stderr.decode(errors='replace')[:300]}")
        return ok
    except FileNotFoundError:
        print("[ffprobe] ffprobe not found — skipping connectivity check")
        return True          # assume ok, let VideoCapture handle it
    except subprocess.TimeoutExpired:
        print(f"[ffprobe] Timeout reaching {url}")
        return False


class FrameBroker:
    """One instance per camera. Opens RTSP once, fans frames to subscribers."""

    def __init__(self, cam_id: str, rtsp_url: str):
        self.cam_id    = cam_id
        self.rtsp_url  = rtsp_url

        # Consumer queues — add more here for additional detectors
        self.fire_queue:   queue.Queue = queue.Queue(maxsize=QUEUE_MAXSIZE)
        self.person_queue: queue.Queue = queue.Queue(maxsize=QUEUE_MAXSIZE)

        # Detectors write annotated frames here for MediaMTX streaming
        self._overlay_lock  = threading.Lock()
        self._overlay_frame: Optional[np.ndarray] = None

        self._stop    = threading.Event()
        self._ffmpeg: Optional[subprocess.Popen] = None

    # ── internal helpers ──────────────────────────────────
    def _open_cap(self) -> cv2.VideoCapture:
        """
        Open VideoCapture with explicit API options passed directly via
        CAP_PROP — these always take effect regardless of when cv2 was
        imported relative to os.environ being set.
        """
        cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE,    1)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,   FRAME_WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT,  FRAME_HEIGHT)
        cap.set(cv2.CAP_PROP_FPS,           TARGET_FPS)
        return cap

    def _push(self, q: queue.Queue, frame: np.ndarray):
        """Non-blocking put — evicts oldest frame when queue is full."""
        try:
            q.put_nowait(frame)
        except queue.Full:
            try:
                q.get_nowait()
                q.put_nowait(frame)
            except Exception:
                pass

    def _start_ffmpeg(self) -> subprocess.Popen:
        """
        Spawn FFmpeg that reads raw BGR frames from stdin and re-publishes
        to MediaMTX as RTSP. Dashboard subscribes to this URL only.
        """
        publish_url = f"rtsp://{MEDIAMTX_HOST}:{MEDIAMTX_PORT}/{self.cam_id}"
        cmd = [
            "ffmpeg", "-y",
            "-loglevel",  "warning",
            "-f",         "rawvideo",
            "-vcodec",    "rawvideo",
            "-pix_fmt",   "bgr24",
            "-s",         f"{FRAME_WIDTH}x{FRAME_HEIGHT}",
            "-r",         str(TARGET_FPS),
            "-i",         "pipe:0",
            "-vcodec",    "libx264",
            "-preset",    "ultrafast",
            "-tune",      "zerolatency",
            "-pix_fmt",   "yuv420p",
            "-g",         str(TARGET_FPS * 2),
            "-f",         "rtsp",
            "-rtsp_transport", "tcp",
            publish_url,
        ]
        print(f"[Broker:{self.cam_id}] FFmpeg → {publish_url}")
        return subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    # ── main capture loop ─────────────────────────────────
    def _run(self):
        retry_delay = 2

        # Wait until the camera is actually reachable
        print(f"[Broker:{self.cam_id}] Checking connectivity...")
        while not self._stop.is_set():
            if _test_rtsp(self.rtsp_url):
                break
            print(f"[Broker:{self.cam_id}] Camera unreachable, retrying in {retry_delay}s...")
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 30)
        if self._stop.is_set():
            return

        retry_delay = 2
        cap = self._open_cap()
        self._ffmpeg = self._start_ffmpeg()

        if not cap.isOpened():
            print(f"[Broker:{self.cam_id}] ERROR: VideoCapture.isOpened() = False. "
                  "Check credentials, IP, and that the camera is on the same network.")
            return

        print(f"[Broker:{self.cam_id}] Capture opened — "
              f"{int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x"
              f"{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))} "
              f"@ {cap.get(cv2.CAP_PROP_FPS):.0f} fps")

        frame_interval    = 1.0 / TARGET_FPS
        last_frame_t      = 0.0
        consecutive_fails = 0

        while not self._stop.is_set():
            ret, raw = cap.read()

            if not ret or raw is None:
                consecutive_fails += 1
                if consecutive_fails >= 5:
                    print(f"[Broker:{self.cam_id}] {consecutive_fails} consecutive "
                          f"read failures — reconnecting in {retry_delay}s...")
                    cap.release()
                    time.sleep(retry_delay)
                    retry_delay = min(retry_delay * 2, 30)
                    cap = self._open_cap()
                    consecutive_fails = 0
                    if cap.isOpened():
                        retry_delay = 2
                continue

            consecutive_fails = 0
            retry_delay = 2

            # Throttle to TARGET_FPS
            now = time.time()
            if now - last_frame_t < frame_interval:
                continue
            last_frame_t = now

            frame = cv2.resize(raw, (FRAME_WIDTH, FRAME_HEIGHT))

            # Fan out to detector queues
            self._push(self.fire_queue,   frame.copy())
            self._push(self.person_queue, frame.copy())

            # Push to FFmpeg (annotated overlay if available, else raw)
            with self._overlay_lock:
                send = self._overlay_frame if self._overlay_frame is not None else frame

            if self._ffmpeg and self._ffmpeg.poll() is None:
                try:
                    self._ffmpeg.stdin.write(send.tobytes())
                except (BrokenPipeError, OSError):
                    print(f"[Broker:{self.cam_id}] FFmpeg pipe broken — restarting")
                    self._ffmpeg = self._start_ffmpeg()
            else:
                self._ffmpeg = self._start_ffmpeg()

        cap.release()
        if self._ffmpeg:
            try:
                self._ffmpeg.stdin.close()
            except Exception:
                pass
            self._ffmpeg.wait()
        print(f"[Broker:{self.cam_id}] Stopped.")

    # ── public API ────────────────────────────────────────
    def update_overlay(self, frame: np.ndarray):
        """Detectors call this to push annotated frames to the dashboard stream."""
        with self._overlay_lock:
            self._overlay_frame = frame

    def start(self):
        self._thread = threading.Thread(
            target=self._run, daemon=True, name=f"broker-{self.cam_id}"
        )
        self._thread.start()

    def stop(self):
        self._stop.set()


# ─── GLOBAL REGISTRY ──────────────────────────────────────
brokers: Dict[str, FrameBroker] = {}


def start_all() -> Dict[str, FrameBroker]:
    for cam in CAMERAS:
        b = FrameBroker(cam["id"], cam["rtsp"])
        b.start()
        brokers[cam["id"]] = b
    return brokers


def stop_all():
    for b in brokers.values():
        b.stop()


# ─── STANDALONE DIAGNOSTIC MODE ───────────────────────────
if __name__ == "__main__":
    import signal, sys

    print("=" * 60)
    print("Frame Broker — standalone diagnostic mode")
    print("=" * 60)

    # Step 1: raw ffprobe test (checks network + credentials)
    for cam in CAMERAS:
        print(f"\n[Diag] ffprobe test: {cam['id']} → {cam['rtsp']}")
        ok = _test_rtsp(cam["rtsp"], timeout=12)
        print(f"[Diag] Result: {'PASS' if ok else 'FAIL — check IP/credentials/network'}")

    # Step 2: direct VideoCapture test — read one frame
    for cam in CAMERAS:
        print(f"\n[Diag] VideoCapture test: {cam['id']}")
        cap = cv2.VideoCapture(cam["rtsp"], cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        opened = cap.isOpened()
        print(f"  isOpened : {opened}")
        if opened:
            ret, frame = cap.read()
            print(f"  read()   : ret={ret}  shape={frame.shape if ret and frame is not None else 'N/A'}")
        else:
            print("  FAILED — VideoCapture could not open the stream")
        cap.release()

    # Step 3: run broker and report FPS
    print("\n[Diag] Starting broker (Ctrl-C to stop)...")
    start_all()

    def _sig(s, f):
        stop_all()
        sys.exit(0)
    signal.signal(signal.SIGINT, _sig)

    counts = {cam["id"]: 0 for cam in CAMERAS}
    t0 = time.time()
    while True:
        for cam_id, b in brokers.items():
            try:
                b.fire_queue.get_nowait()
                counts[cam_id] += 1
            except queue.Empty:
                pass
        elapsed = time.time() - t0
        if elapsed >= 5.0:
            for cam_id, cnt in counts.items():
                print(f"  [{cam_id}] {cnt / elapsed:.1f} fps to consumers")
            counts = {k: 0 for k in counts}
            t0 = time.time()
        time.sleep(0.001)
