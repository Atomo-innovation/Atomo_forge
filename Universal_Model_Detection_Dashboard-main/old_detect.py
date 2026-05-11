#!/usr/bin/env python3
"""
ASNN Detection Script
Outputs structured JSON lines to stdout so the Node.js server
can stream results to the browser via WebSocket.

JSON output format per frame:
  {"frame": N, "fps": F, "inference_ms": T, "detections": [{...}, ...]}

Detection format:
  {"class_id": 0, "class_name": "Car", "score": 0.92, "box": [x1,y1,x2,y2]}
"""

import numpy as np
import os
import sys
import json
import math
import time
import threading
import queue
import argparse
import cv2 as cv

# Try importing ASNN (may not be available on dev machine)
try:
    from asnn.api import asnn
    from asnn.types import output_format
    ASNN_AVAILABLE = True
except ImportError:
    ASNN_AVAILABLE = False
    print(json.dumps({"type": "log", "level": "warn",
                      "message": "asnn module not found — running in simulation mode"}), flush=True)

# ── Constants (overridable via args) ──────────────────────────────
GRID0    = 20
GRID1    = 40
GRID2    = 80
SPAN     = 1
MAX_BOXES= 500

constant_matrix = np.array([[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]]).T

mean = [0, 0, 0]
var  = [255]

os.environ["QT_QPA_PLATFORM"] = "offscreen"  # No display needed — output via JSON

# ── Args ──────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--library",    help="Path to .so library")
parser.add_argument("--model",      help="Path to .nb model file")
parser.add_argument("--type",       help="Input type: usb|rtsp|video|image|mipi")
parser.add_argument("--device",     help="Device index or file path or RTSP URL")
parser.add_argument("--level",      default="0", help="Log level 0/1/2")
parser.add_argument("--obj-thresh", type=float, default=0.4)
parser.add_argument("--nms-thresh", type=float, default=0.5)
parser.add_argument("--platform",   default="ONNX")
parser.add_argument("--classes",    nargs="+", default=None, help="Class names (overrides data.yaml)")
parser.add_argument("--num-cls",    type=int, default=None)
parser.add_argument("--listsize",   type=int, default=None)
args = parser.parse_args()

OBJ_THRESH = args.obj_thresh
NMS_THRESH = args.nms_thresh

# ── Load class names from data.yaml if present ────────────────────
CLASSES  = None
NUM_CLS  = 1
LISTSIZE = 65

if args.classes:
    CLASSES  = tuple(args.classes)
    NUM_CLS  = len(CLASSES)
    LISTSIZE = NUM_CLS + 64
elif args.model:
    # Try to find data.yaml in same directory as model
    model_dir = os.path.dirname(args.model)
    for yaml_name in ['data.yaml', 'dataset.yaml']:
        yaml_path = os.path.join(model_dir, yaml_name)
        if os.path.exists(yaml_path):
            try:
                import yaml
                with open(yaml_path) as f:
                    ydata = yaml.safe_load(f)
                names = ydata.get('names', [])
                if isinstance(names, dict):
                    names = [names[k] for k in sorted(names.keys())]
                if names:
                    CLASSES  = tuple(names)
                    NUM_CLS  = len(CLASSES)
                    LISTSIZE = NUM_CLS + 64
                    print(json.dumps({"type": "log", "level": "info",
                                      "message": f"Loaded {NUM_CLS} classes from {yaml_name}: {', '.join(CLASSES)}"}), flush=True)
                break
            except Exception as e:
                print(json.dumps({"type": "log", "level": "warn",
                                  "message": f"Could not parse {yaml_name}: {e}"}), flush=True)

if CLASSES is None:
    CLASSES  = ("Object",)
    NUM_CLS  = 1
    LISTSIZE = 65

if args.num_cls:    NUM_CLS  = args.num_cls
if args.listsize:   LISTSIZE = args.listsize

# ── Post-processing ───────────────────────────────────────────────
def sigmoid(x):
    return 1 / (1 + np.exp(-x))

def softmax(x, axis=0):
    x = np.exp(x - x.max(axis=axis, keepdims=True))
    return x / x.sum(axis=axis, keepdims=True)

def process(inp):
    grid_h, grid_w = inp.shape[0], inp.shape[1]
    box_class_probs = sigmoid(inp[..., :NUM_CLS])
    box_0 = softmax(inp[..., NUM_CLS:NUM_CLS+16], -1)
    box_1 = softmax(inp[..., NUM_CLS+16:NUM_CLS+32], -1)
    box_2 = softmax(inp[..., NUM_CLS+32:NUM_CLS+48], -1)
    box_3 = softmax(inp[..., NUM_CLS+48:NUM_CLS+64], -1)

    result = np.zeros((grid_h, grid_w, 1, 4))
    result[..., 0] = np.dot(box_0, constant_matrix)[..., 0]
    result[..., 1] = np.dot(box_1, constant_matrix)[..., 0]
    result[..., 2] = np.dot(box_2, constant_matrix)[..., 0]
    result[..., 3] = np.dot(box_3, constant_matrix)[..., 0]

    col = np.tile(np.arange(0, grid_w), grid_w).reshape(-1, grid_w)
    row = np.tile(np.arange(0, grid_h).reshape(-1, 1), grid_h)
    col = col.reshape(grid_h, grid_w, 1, 1)
    row = row.reshape(grid_h, grid_w, 1, 1)
    grid = np.concatenate((col, row), axis=-1)
    result[..., 0:2] = (0.5 - result[..., 0:2] + grid) / (grid_w, grid_h)
    result[..., 2:4] = (0.5 + result[..., 2:4] + grid) / (grid_w, grid_h)
    return result, box_class_probs

def filter_boxes(boxes, probs):
    classes = np.argmax(probs, axis=-1)
    scores  = np.max(probs, axis=-1)
    pos     = np.where(scores >= OBJ_THRESH)
    return boxes[pos], classes[pos], scores[pos]

def nms_boxes(boxes, scores):
    x1, y1, x2, y2 = boxes[:,0], boxes[:,1], boxes[:,2], boxes[:,3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep  = []
    while order.size > 0:
        i = order[0]; keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2-xx1+1e-5) * np.maximum(0, yy2-yy1+1e-5)
        ovr   = inter / (areas[i] + areas[order[1:]] - inter)
        order = order[np.where(ovr <= NMS_THRESH)[0] + 1]
    return np.array(keep)

def yolov3_post(input_data):
    boxes_l, classes_l, scores_l = [], [], []
    for i in range(3):
        result, conf = process(input_data[i])
        b, c, s = filter_boxes(result, conf)
        boxes_l.append(b); classes_l.append(c); scores_l.append(s)

    boxes   = np.concatenate(boxes_l)
    classes = np.concatenate(classes_l)
    scores  = np.concatenate(scores_l)

    if len(boxes) == 0:
        return None, None, None

    nboxes, nclasses, nscores = [], [], []
    for c in set(classes):
        inds = np.where(classes == c)
        b, cc, s = boxes[inds], classes[inds], scores[inds]
        keep = nms_boxes(b, s)
        nboxes.append(b[keep]); nclasses.append(cc[keep]); nscores.append(s[keep])

    if not nclasses:
        return None, None, None

    return np.concatenate(nboxes), np.concatenate(nscores), np.concatenate(nclasses)

def format_detections(boxes, scores, classes):
    dets = []
    if boxes is None:
        return dets
    for box, score, cl in zip(boxes, scores, classes):
        x1, y1, x2, y2 = box
        x1 = float(np.clip(x1, 0, 1))
        y1 = float(np.clip(y1, 0, 1))
        x2 = float(np.clip(x2, 0, 1))
        y2 = float(np.clip(y2, 0, 1))
        dets.append({
            "class_id":   int(cl),
            "class_name": CLASSES[int(cl)] if int(cl) < len(CLASSES) else "Unknown",
            "score":      round(float(score), 4),
            "box":        [round(x1,4), round(y1,4), round(x2,4), round(y2,4)]
        })
    return dets

# ── Preprocess image ──────────────────────────────────────────────
def preprocess(img):
    resized = cv.resize(img, (640, 640)).astype(np.float32)
    resized[:,:,0] -= mean[0]
    resized[:,:,1] -= mean[1]
    resized[:,:,2] -= mean[2]
    resized /= var[0]
    return resized.transpose(2, 0, 1)

# ── Video/RTSP frame capture thread ──────────────────────────────
frame_q = queue.Queue(maxsize=2)

def capture_frames(cap_type, cap_device):
    if cap_type == "usb":
        cap = cv.VideoCapture(int(cap_device), cv.CAP_V4L2)
        cap.set(cv.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv.CAP_PROP_FRAME_HEIGHT, 480)
    elif cap_type == "rtsp":
        url = f"{cap_device}?tcp&buffer_size=0&fflags=nobuffer&flags=low_delay"
        cap = cv.VideoCapture(url, cv.CAP_FFMPEG)
        cap.set(cv.CAP_PROP_BUFFERSIZE, 1)
    elif cap_type == "video":
        cap = cv.VideoCapture(cap_device)
    elif cap_type == "mipi":
        pipeline = f"v4l2src device=/dev/video{cap_device} io-mode=dmabuf ! video/x-raw,format=NV12,width=1920,height=1080,framerate=30/1 ! videoconvert ! appsink"
        cap = cv.VideoCapture(pipeline, cv.CAP_GSTREAMER)
    else:
        print(json.dumps({"type": "log", "level": "err", "message": f"Unsupported type: {cap_type}"}), flush=True)
        sys.exit(1)

    if not cap.isOpened():
        print(json.dumps({"type": "log", "level": "err", "message": f"Cannot open capture: {cap_type}:{cap_device}"}), flush=True)
        sys.exit(1)

    skip = 0
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            if cap_type == "video": break  # End of video
            continue
        # For live sources skip frames to reduce latency
        if cap_type in ("usb", "rtsp", "mipi"):
            skip += 1
            if skip % 3 != 0: continue
        try:
            frame_q.put_nowait(frame)
        except queue.Full:
            pass  # Drop frame
    cap.release()

# ── Main ──────────────────────────────────────────────────────────
def main():
    if not args.model or not os.path.exists(args.model):
        print(json.dumps({"type": "log", "level": "err", "message": f"Model not found: {args.model}"}), flush=True)
        sys.exit(1)
    if not args.library or not os.path.exists(args.library):
        print(json.dumps({"type": "log", "level": "err", "message": f"Library not found: {args.library}"}), flush=True)
        sys.exit(1)

    cap_type = args.type
    cap_dev  = args.device
    level    = int(args.level) if args.level in ['1','2'] else 0

    print(json.dumps({"type": "log", "level": "info",
                      "message": f"Initializing ASNN | model={args.model} | type={cap_type} | device={cap_dev}"}), flush=True)

    # ── Init neural network ────────────────────────────────────────
    if ASNN_AVAILABLE:
        nn = asnn('Electron')
        print(json.dumps({"type": "log", "level": "info",
                          "message": f"ASNN version: {nn.get_nn_version()}"}), flush=True)
        nn.nn_init(library=args.library, model=args.model, level=level)
        print(json.dumps({"type": "log", "level": "info", "message": "Neural network ready"}), flush=True)
    else:
        nn = None

    # ── Single image mode ──────────────────────────────────────────
    if cap_type == "image":
        img = cv.imread(cap_dev)
        if img is None:
            print(json.dumps({"type": "log", "level": "err", "message": f"Cannot read image: {cap_dev}"}), flush=True)
            sys.exit(1)

        t0 = time.time()
        if nn:
            proc_img = preprocess(img)
            data = nn.nn_inference([proc_img], platform=args.platform, reorder='2 1 0',
                                   output_tensor=3, output_format=output_format.OUT_FORMAT_FLOAT32)
            input_data = [
                np.transpose(data[2].reshape(SPAN, LISTSIZE, GRID0, GRID0), (2,3,0,1)),
                np.transpose(data[1].reshape(SPAN, LISTSIZE, GRID1, GRID1), (2,3,0,1)),
                np.transpose(data[0].reshape(SPAN, LISTSIZE, GRID2, GRID2), (2,3,0,1)),
            ]
            boxes, scores, classes = yolov3_post(input_data)
            dets = format_detections(boxes, scores, classes)
        else:
            # Simulation
            import random
            dets = [{"class_id":0,"class_name":CLASSES[0],"score":round(random.uniform(.6,.95),3),
                     "box":[round(random.uniform(.1,.5),3),round(random.uniform(.1,.5),3),
                            round(random.uniform(.5,.9),3),round(random.uniform(.5,.9),3)]}]

        inf_ms = round((time.time() - t0) * 1000, 2)
        result = {"frame": 1, "fps": 1.0, "inference_ms": inf_ms, "detections": dets}
        print(json.dumps(result), flush=True)
        return

    # ── Video / Live capture mode ──────────────────────────────────
    t = threading.Thread(target=capture_frames, args=(cap_type, cap_dev), daemon=True)
    t.start()

    frame_num   = 0
    fps_count   = 0
    fps_start   = time.time()
    fps_val     = 0.0

    print(json.dumps({"type": "log", "level": "info", "message": "Capture thread started"}), flush=True)

    while True:
        try:
            orig = frame_q.get(timeout=2)
        except queue.Empty:
            continue

        t0 = time.time()
        frame_num += 1

        if nn:
            proc_img = preprocess(orig)
            data = nn.nn_inference([proc_img], platform=args.platform, reorder='2 1 0',
                                   output_tensor=3, output_format=output_format.OUT_FORMAT_FLOAT32)
            input_data = [
                np.transpose(data[2].reshape(SPAN, LISTSIZE, GRID0, GRID0), (2,3,0,1)),
                np.transpose(data[1].reshape(SPAN, LISTSIZE, GRID1, GRID1), (2,3,0,1)),
                np.transpose(data[0].reshape(SPAN, LISTSIZE, GRID2, GRID2), (2,3,0,1)),
            ]
            boxes, scores, classes = yolov3_post(input_data)
            dets = format_detections(boxes, scores, classes)
        else:
            import random
            count = random.randint(0, 2) if random.random() > 0.4 else 0
            dets  = []
            for _ in range(count):
                cls  = random.randint(0, NUM_CLS-1)
                x1   = random.uniform(.05, .55)
                y1   = random.uniform(.05, .55)
                dets.append({
                    "class_id": cls, "class_name": CLASSES[cls],
                    "score": round(random.uniform(.45, .97), 3),
                    "box": [round(x1,4), round(y1,4),
                            round(min(x1+random.uniform(.1,.3), .98),4),
                            round(min(y1+random.uniform(.1,.3), .98),4)]
                })

        inf_ms = round((time.time() - t0) * 1000, 2)

        # FPS
        fps_count += 1
        elapsed    = time.time() - fps_start
        if elapsed >= 1.0:
            fps_val   = round(fps_count / elapsed, 2)
            fps_count = 0
            fps_start = time.time()

        result = {
            "frame":        frame_num,
            "fps":          fps_val,
            "inference_ms": inf_ms,
            "detections":   dets
        }
        print(json.dumps(result), flush=True)

if __name__ == '__main__':
    main()
