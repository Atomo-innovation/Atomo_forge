#!/usr/bin/env python3
"""
Person Detection with MQTT Publishing for Multiple RTSP Cameras
Uses YOLOv3 person detection only (no gender/InspireFace)
Publishes real-time detection data including bounding boxes via MQTT
All detections reported as 'Unknown' gender
"""

import os

# ============================================================
# CRITICAL: These MUST be set before cv2 is imported.
# OpenCV's FFmpeg backend reads them at import time.
# ============================================================
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
    "rtsp_transport;tcp"
    "|fflags;nobuffer+discardcorrupt"
    "|flags;low_delay"
    "|analyzeduration;500000"
    "|probesize;500000"
    "|stimeout;10000000"          # 10 s socket timeout
    "|tcp_nodelay;1"
    "|reconnect;1"                # auto-reconnect on disconnect
    "|reconnect_streamed;1"
    "|reconnect_delay_max;5"      # max 5 s between reconnect attempts
)
os.environ["QT_QPA_PLATFORM"] = "xcb"

import numpy as np
import argparse
import sys
import cv2 as cv
import time
import threading
import queue
import json
from datetime import datetime

# MQTT Client
import paho.mqtt.client as mqtt

# ASNN for person detection
from asnn.api import asnn
from asnn.types import *

# ==================== YOLO CONSTANTS ====================
GRID0 = 20
GRID1 = 40
GRID2 = 80
LISTSIZE = 65
SPAN = 1
NUM_CLS = 1
MAX_BOXES = 500
OBJ_THRESH = 0.3
NMS_THRESH = 0.5

mean = [0, 0, 0]
var  = [255]

constant_martix = np.array([[0, 1, 2, 3,
                              4, 5, 6, 7,
                              8, 9, 10, 11,
                              12, 13, 14, 15]]).T

CLASSES = ("Person",)

# ==================== MQTT CONFIG ====================
MQTT_BROKER           = "localhost"
MQTT_PORT             = 1883
MQTT_USERNAME         = "rajat"
MQTT_PASSWORD         = "asdf"
MQTT_TOPIC_DETECTIONS = "atomo/store/person_detections"
MQTT_TOPIC_STATS      = "atomo/store/detection_stats"
MQTT_PUBLISH_INTERVAL = 0.5   # seconds

# ==================== DISPLAY COLORS (BGR) ====================
COLORS = {
    "Unknown": (160, 160, 160),
    "overlay": (  0,   0,   0),
    "text":    (255, 255, 255),
    "accent":  ( 50, 205,  50),
}

# ==================== STATISTICS ====================
lifetime_total   = 0
lifetime_unknown = 0


# ==================== YOLO HELPER FUNCTIONS ====================
def sigmoid(x):
    return 1 / (1 + np.exp(-x))

def softmax(x, axis=0):
    x = np.exp(x)
    return x / x.sum(axis=axis, keepdims=True)

def process(input):
    grid_h, grid_w = map(int, input.shape[0:2])

    box_class_probs = sigmoid(input[..., :NUM_CLS])
    box_0 = softmax(input[..., NUM_CLS:       NUM_CLS + 16], -1)
    box_1 = softmax(input[..., NUM_CLS + 16:  NUM_CLS + 32], -1)
    box_2 = softmax(input[..., NUM_CLS + 32:  NUM_CLS + 48], -1)
    box_3 = softmax(input[..., NUM_CLS + 48:  NUM_CLS + 64], -1)

    result = np.zeros((grid_h, grid_w, 1, 4))
    result[..., 0] = np.dot(box_0, constant_martix)[..., 0]
    result[..., 1] = np.dot(box_1, constant_martix)[..., 0]
    result[..., 2] = np.dot(box_2, constant_martix)[..., 0]
    result[..., 3] = np.dot(box_3, constant_martix)[..., 0]

    col = np.tile(np.arange(0, grid_w), grid_w).reshape(-1, grid_w)
    row = np.tile(np.arange(0, grid_h).reshape(-1, 1), grid_h)
    col = col.reshape(grid_h, grid_w, 1, 1)
    row = row.reshape(grid_h, grid_w, 1, 1)
    grid = np.concatenate((col, row), axis=-1)

    result[..., 0:2] = (0.5 - result[..., 0:2] + grid) / (grid_w, grid_h)
    result[..., 2:4] = (0.5 + result[..., 2:4] + grid) / (grid_w, grid_h)
    return result, box_class_probs

def filter_boxes(boxes, box_class_probs):
    box_classes      = np.argmax(box_class_probs, axis=-1)
    box_class_scores = np.max(box_class_probs,    axis=-1)
    pos     = np.where(box_class_scores >= OBJ_THRESH)
    boxes   = boxes[pos]
    classes = box_classes[pos]
    scores  = box_class_scores[pos]
    return boxes, classes, scores

def nms_boxes(boxes, scores):
    x1 = boxes[:, 0]; y1 = boxes[:, 1]
    x2 = boxes[:, 2]; y2 = boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep  = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w1   = np.maximum(0.0, xx2 - xx1 + 0.00001)
        h1   = np.maximum(0.0, yy2 - yy1 + 0.00001)
        inter = w1 * h1
        ovr   = inter / (areas[i] + areas[order[1:]] - inter)
        inds  = np.where(ovr <= NMS_THRESH)[0]
        order = order[inds + 1]
    return np.array(keep)

def yolov3_post_process(input_data):
    boxes, classes, scores = [], [], []
    for i in range(3):
        result, confidence = process(input_data[i])
        b, c, s = filter_boxes(result, confidence)
        boxes.append(b); classes.append(c); scores.append(s)

    boxes   = np.concatenate(boxes)
    classes = np.concatenate(classes)
    scores  = np.concatenate(scores)

    nboxes, nclasses, nscores = [], [], []
    for c in set(classes):
        inds = np.where(classes == c)
        b = boxes[inds]; c = classes[inds]; s = scores[inds]
        keep = nms_boxes(b, s)
        nboxes.append(b[keep]); nclasses.append(c[keep]); nscores.append(s[keep])

    if not nclasses and not nscores:
        return None, None, None

    boxes   = np.concatenate(nboxes)
    classes = np.concatenate(nclasses)
    scores  = np.concatenate(nscores)
    return boxes, scores, classes


# ==================== MQTT MANAGER ====================
class MQTTManager:
    def __init__(self):
        self.client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2
        )
        self.connected         = False
        self.last_publish_time = 0

    def on_connect(self, client, userdata, flags, rc, properties=None):
        self.connected = (rc == 0)
        status = "Connected" if self.connected else f"Error rc={rc}"
        print(f"[MQTT] {status}")

    def connect(self):
        self.client.on_connect = self.on_connect
        self.client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        try:
            self.client.connect(MQTT_BROKER, MQTT_PORT, 60)
            self.client.loop_start()
        except Exception as e:
            print(f"[MQTT] Connection failed: {e}")

    def publish_detections(self, detections, camera_id):
        if not self.connected:
            return
        current_time = time.time()
        if current_time - self.last_publish_time < MQTT_PUBLISH_INTERVAL:
            return
        payload = {
            "timestamp":       current_time,
            "datetime":        datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            "camera_id":       camera_id,
            "detection_count": len(detections),
            "detections":      detections,
        }
        try:
            self.client.publish(MQTT_TOPIC_DETECTIONS, json.dumps(payload), qos=1)
            self.last_publish_time = current_time
        except Exception as e:
            print(f"[MQTT] Publish error: {e}")

    def publish_stats(self, stats):
        if not self.connected:
            return
        try:
            self.client.publish(MQTT_TOPIC_STATS, json.dumps(stats), qos=1)
        except Exception as e:
            print(f"[MQTT] Stats publish error: {e}")

    def disconnect(self):
        self.client.loop_stop()
        self.client.disconnect()


# ==================== VISUALIZATION ====================
def draw_detections(frame, detections):
    vis  = frame.copy()
    color = COLORS["Unknown"]

    for det in detections:
        b    = det["bbox"]
        conf = det["confidence"]
        x1, y1, x2, y2 = b["x1"], b["y1"], b["x2"], b["y2"]

        # Semi-transparent fill
        overlay = vis.copy()
        cv.rectangle(overlay, (x1, y1), (x2, y2), color, -1)
        cv.addWeighted(overlay, 0.08, vis, 0.92, 0, vis)
        # Border
        cv.rectangle(vis, (x1, y1), (x2, y2), color, 2)

        # Corner ticks
        tick = 12
        for px, py, dx, dy in [(x1,y1,1,1),(x2,y1,-1,1),(x1,y2,1,-1),(x2,y2,-1,-1)]:
            cv.line(vis, (px, py), (px + dx*tick, py), color, 3)
            cv.line(vis, (px, py), (px, py + dy*tick), color, 3)

        # Label
        label = f"Person  {conf:.0%}"
        font  = cv.FONT_HERSHEY_DUPLEX
        fs    = 0.52
        thick = 1
        (tw, th), _ = cv.getTextSize(label, font, fs, thick)
        pad  = 4
        lx1, ly1 = x1, max(0, y1 - th - pad*2)
        lx2, ly2 = x1 + tw + pad*2, y1
        cv.rectangle(vis, (lx1, ly1), (lx2, ly2), color, -1)
        cv.putText(vis, label, (lx1 + pad, ly2 - pad), font, fs,
                   (255, 255, 255), thick, cv.LINE_AA)

        # Center marker
        cx, cy = b["center_x"], b["center_y"]
        cv.drawMarker(vis, (cx, cy), color, markerType=cv.MARKER_CROSS,
                      markerSize=12, thickness=1)
    return vis

def draw_hud(vis, camera_id, total, fps):
    h, w  = vis.shape[:2]
    lines = [
        f" {camera_id} ",
        f" FPS   : {fps:5.1f} ",
        f" Total : {total:3d} ",
    ]
    font    = cv.FONT_HERSHEY_DUPLEX
    fs      = 0.5
    thick   = 1
    pad     = 6
    line_h  = 22
    panel_w = 160
    panel_h = len(lines) * line_h + pad * 2
    px1, py1 = w - panel_w - 10, 10
    px2, py2 = w - 10, 10 + panel_h

    overlay = vis.copy()
    cv.rectangle(overlay, (px1, py1), (px2, py2), (20, 20, 20), -1)
    cv.addWeighted(overlay, 0.70, vis, 0.30, 0, vis)
    cv.rectangle(vis, (px1, py1), (px2, py2), COLORS["accent"], 1)
    cv.rectangle(vis, (px1, py1), (px2, py1 + line_h), COLORS["accent"], -1)

    for i, line in enumerate(lines):
        color = (0, 0, 0) if i == 0 else COLORS["text"]
        y = py1 + pad + (i + 1) * line_h - 4
        cv.putText(vis, line, (px1 + pad, y), font, fs, color, thick, cv.LINE_AA)

    ts = datetime.now().strftime("%Y-%m-%d  %H:%M:%S")
    cv.putText(vis, ts, (10, h - 10), font, 0.42, (180, 180, 180), 1, cv.LINE_AA)
    return vis


# ==================== DETECTION PROCESSING ====================
def process_detections(frame, boxes, scores, classes, mqtt_manager, camera_id):
    global lifetime_total, lifetime_unknown

    h, w = frame.shape[:2]
    detections = []

    if boxes is None:
        mqtt_manager.publish_detections(detections, camera_id)
        return detections

    for idx, (box, score, cl) in enumerate(zip(boxes, scores, classes)):
        x1 = max(0, int(box[0] * w))
        y1 = max(0, int(box[1] * h))
        x2 = min(w, int(box[2] * w))
        y2 = min(h, int(box[3] * h))

        detections.append({
            "detection_id": idx,
            "class":        CLASSES[cl],
            "confidence":   float(score),
            "bbox": {
                "x1":       x1,
                "y1":       y1,
                "x2":       x2,
                "y2":       y2,
                "width":    x2 - x1,
                "height":   y2 - y1,
                "center_x": (x1 + x2) // 2,
                "center_y": (y1 + y2) // 2,
            },
            "gender": {
                "label":      "Unknown",
                "id":         -1,
                "confidence": 0.0,
            }
        })

    mqtt_manager.publish_detections(detections, camera_id)
    return detections


# ==================== FRAME CAPTURE THREAD ====================
def capture_frames(cap_type, cap_num, camera_id, cam_queue):
    MAX_RETRY_DELAY = 30

    def open_cap():
        if cap_type == "usb":
            c = cv.VideoCapture(int(cap_num), cv.CAP_V4L2)
            c.set(cv.CAP_PROP_FRAME_WIDTH,  640)
            c.set(cv.CAP_PROP_FRAME_HEIGHT, 480)
        elif cap_type == "rtsp":
            c = cv.VideoCapture(cap_num, cv.CAP_FFMPEG)
            c.set(cv.CAP_PROP_FRAME_WIDTH,  640)
            c.set(cv.CAP_PROP_FRAME_HEIGHT, 480)
            c.set(cv.CAP_PROP_FPS,          15)
            c.set(cv.CAP_PROP_BUFFERSIZE,    1)
        elif cap_type == "mipi":
            pipeline = (
                f"v4l2src device=/dev/video{cap_num} io-mode=dmabuf ! "
                "video/x-raw,format=NV12,width=1920,height=1080,framerate=30/1 ! "
                "queue ! videoconvert ! appsink"
            )
            c = cv.VideoCapture(pipeline, cv.CAP_GSTREAMER)
        else:
            sys.exit(f"Unsupported camera type '{cap_type}'")
        return c

    print(f"[Camera] Starting capture thread for {camera_id} ({cap_type})")
    retry_delay = 2
    cap = open_cap()

    while True:
        if not cap.isOpened():
            print(f"[Camera] {camera_id} not open. Retrying in {retry_delay}s...")
            cap.release()
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, MAX_RETRY_DELAY)
            cap = open_cap()
            retry_delay = 2
            continue

        # Drain stale buffered frames
        for _ in range(10):
            cap.grab()

        ret, frame = cap.read()
        if not ret or frame is None:
            print(f"[Camera] {camera_id} read failed. Reconnecting in {retry_delay}s...")
            cap.release()
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, MAX_RETRY_DELAY)
            cap = open_cap()
            retry_delay = 2
            continue

        # Skip frame if inference is falling behind
        if cam_queue.qsize() >= 2:
            continue

        try:
            cam_queue.put_nowait((camera_id, frame))
        except queue.Full:
            try:
                cam_queue.get_nowait()
                cam_queue.put_nowait((camera_id, frame))
            except Exception:
                pass


# ==================== MAIN ====================
if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Person Detection with MQTT for Multiple RTSP Cameras'
    )
    parser.add_argument("--library",       required=True,            help="Path to C static library file")
    parser.add_argument("--model",         required=True,            help="Path to nbg file")
    parser.add_argument("--rtsp_urls",     nargs='+', required=True, help="List of RTSP URLs (space-separated)")
    parser.add_argument("--level",         default="0",              help="Info printer level: 0/1/2")
    parser.add_argument("--mqtt-broker",   default=MQTT_BROKER,      help="MQTT broker address")
    parser.add_argument("--mqtt-port",     default=MQTT_PORT,        type=int, help="MQTT port")
    parser.add_argument("--mqtt-username", default=MQTT_USERNAME,    help="MQTT username")
    parser.add_argument("--mqtt-password", default=MQTT_PASSWORD,    help="MQTT password")
    parser.add_argument("--show",          action="store_true",
                        help="Show live detection window (press Q or Esc to quit)")
    args = parser.parse_args()

    if not os.path.exists(args.model):
        sys.exit(f"Model '{args.model}' does not exist")
    if not os.path.exists(args.library):
        sys.exit(f"Library '{args.library}' does not exist")

    level = int(args.level) if args.level in ['1', '2'] else 0

    if args.mqtt_broker   != MQTT_BROKER:   MQTT_BROKER   = args.mqtt_broker
    if args.mqtt_username != MQTT_USERNAME: MQTT_USERNAME = args.mqtt_username
    if args.mqtt_password != MQTT_PASSWORD: MQTT_PASSWORD = args.mqtt_password

    # ---- YOLO init ----
    print('[YOLO] Initializing neural network...')
    yolov3 = asnn('Electron')
    print(f'[YOLO] ASNN Version: {yolov3.get_nn_version()}')
    yolov3.nn_init(library=args.library, model=args.model, level=level)
    print('[YOLO] Initialization complete')

    # ---- MQTT init ----
    print('[MQTT] Connecting to broker...')
    mqtt_manager = MQTTManager()
    mqtt_manager.connect()
    time.sleep(1)

    # ---- Per-camera frame queues + capture threads ----
    camera_ids   = []
    frame_queues = {}

    for i, url in enumerate(args.rtsp_urls):
        cid = f"camera_{i+1:02d}"
        camera_ids.append(cid)
        frame_queues[cid] = queue.Queue(maxsize=4)
        t = threading.Thread(
            target=capture_frames,
            args=("rtsp", url, cid, frame_queues[cid]),
            daemon=True
        )
        t.start()

    # ---- Display windows ----
    if args.show:
        for cid in camera_ids:
            cv.namedWindow(cid, cv.WINDOW_NORMAL)
            cv.resizeWindow(cid, 960, 540)

    print('\n' + '='*60)
    print('PERSON DETECTION WITH MQTT STARTED')
    print('='*60)
    print(f'MQTT Detections : {MQTT_TOPIC_DETECTIONS}')
    print(f'MQTT Statistics : {MQTT_TOPIC_STATS}')
    print(f'Cameras         : {", ".join(camera_ids)}')
    if args.show:
        print('Display         : ON  (press Q or Esc to quit)')
    print('='*60 + '\n')

    frame_count     = 0
    start_time      = time.time()
    last_stats_time = time.time()
    fps             = 0.0

    current_stats = {cid: {"unknown": 0, "total": 0} for cid in camera_ids}
    latest_vis    = {}

    agg_current_total = 0

    try:
        while True:
            # Round-robin across per-camera queues
            got_frame = False
            for cid in camera_ids:
                try:
                    camera_id, orig_img = frame_queues[cid].get_nowait()
                    got_frame = True
                    break
                except queue.Empty:
                    continue

            if not got_frame:
                time.sleep(0.005)
                if args.show:
                    for cid, vis in latest_vis.items():
                        cv.imshow(cid, vis)
                    if cv.waitKey(1) & 0xFF in (ord('q'), ord('Q'), 27):
                        break
                continue

            if orig_img is None:
                continue

            inference_start = time.time()

            # ---- Pre-process for YOLO ----
            img = cv.resize(orig_img, (640, 640)).astype(np.float32)
            img[:, :, 0] -= mean[0]
            img[:, :, 1] -= mean[1]
            img[:, :, 2] -= mean[2]
            img /= var[0]
            img = img.transpose(2, 0, 1)

            data = yolov3.nn_inference(
                [img],
                platform='ONNX',
                reorder='2 1 0',
                output_tensor=3,
                output_format=output_format.OUT_FORMAT_FLOAT32
            )

            input0_data = data[2].reshape(SPAN, LISTSIZE, GRID0, GRID0)
            input1_data = data[1].reshape(SPAN, LISTSIZE, GRID1, GRID1)
            input2_data = data[0].reshape(SPAN, LISTSIZE, GRID2, GRID2)
            input_data  = [
                np.transpose(input0_data, (2, 3, 0, 1)),
                np.transpose(input1_data, (2, 3, 0, 1)),
                np.transpose(input2_data, (2, 3, 0, 1)),
            ]

            boxes, scores, classes = yolov3_post_process(input_data)

            detections = process_detections(
                orig_img, boxes, scores, classes,
                mqtt_manager, camera_id
            )

            c_total = len(detections)
            current_stats[camera_id] = {
                "unknown": c_total,
                "total":   c_total,
            }

            lifetime_total   += c_total
            lifetime_unknown += c_total

            inference_time = time.time() - inference_start
            fps = 1.0 / max(inference_time, 1e-6)

            # ---- Display ----
            if args.show:
                vis = draw_detections(orig_img, detections)
                vis = draw_hud(vis, camera_id, c_total, fps)
                latest_vis[camera_id] = vis
                cv.imshow(camera_id, vis)
                if cv.waitKey(1) & 0xFF in (ord('q'), ord('Q'), 27):
                    break

            # ---- Publish stats every 5 s ----
            if time.time() - last_stats_time > 5.0:
                agg_current_total = sum(s["total"] for s in current_stats.values())

                mqtt_manager.publish_stats({
                    "timestamp": time.time(),
                    "datetime":  datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "current": {
                        "total":      agg_current_total,
                        "unknown":    agg_current_total,
                        "per_camera": current_stats,
                    },
                    "lifetime": {
                        "total":   lifetime_total,
                        "unknown": lifetime_unknown,
                    },
                    "performance": {
                        "fps":               fps,
                        "inference_time_ms": inference_time * 1000,
                    }
                })
                last_stats_time = time.time()

            # ---- Console log every 30 frames ----
            frame_count += 1
            if frame_count % 30 == 0:
                elapsed = time.time() - start_time
                print(
                    f"[Stats] FPS: {frame_count / elapsed:.2f} | "
                    f"Camera: {camera_id} | "
                    f"Detections: {agg_current_total}"
                )
                frame_count = 0
                start_time  = time.time()

    except KeyboardInterrupt:
        print("\n[System] Shutting down...")

    finally:
        if args.show:
            cv.destroyAllWindows()
        mqtt_manager.disconnect()
        print("[System] Cleanup complete. Goodbye!")
