#!/usr/bin/env python3
"""
Combined Real-Time Fire + Person Detection
- Fire: YOLOv8 ONNX on NPU + Email + MQTT (every second)
- Person: ASNN YOLOv3 + MQTT (every second with bbox)
- Improved Fire detection: Reduced false positives on TV monitors
"""

import cv2
import numpy as np
import threading
import queue
import subprocess
import time
import json
import argparse
import os
from datetime import datetime

# Fire dependencies
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.image import MIMEImage
import paho.mqtt.client as mqtt_client

# Person dependencies
from asnn.api import asnn
from asnn.types import output_format

# ====================== ARGUMENTS ======================
parser = argparse.ArgumentParser(description="Combined Fire + Person Real-Time Detection")
parser.add_argument('--display', action='store_true', help='Show detection windows')
parser.add_argument('--save', type=str, default=None, help='Directory to save output videos')
parser.add_argument('--library', required=True, help='Path to ASNN C library (.so)')
parser.add_argument('--model', required=True, help='Path to ASNN .nbg model file')
args = parser.parse_args()

# ====================== CAMERA CONFIG ======================
CAMERAS = [
    ("workstation", "rtsp://localhost:8554/workstation"),
    ("pdpu", "rtsp://localhost:8554/pdeu")
]


WIDTH = 640
HEIGHT = 480
RECONNECT_DELAY = 5

# ====================== FIRE CONFIG (Improved against TV false positives) ======================
MODEL_PATH = "fire.onnx"
INPUT_SIZE = 640
CONF_THRESH = 0.65                    # Increased to reduce TV false triggers
NMS_THRESH = 0.5
MIN_FIRE_AREA = 800                   # Ignore very small detections (common on TV)
MAX_ASPECT_RATIO = 3.0                # Fire usually not extremely wide

CLASSES_FIRE = ["fire", "FIRE"]

# ====================== PERSON CONFIG ======================
GRID0 = 20
GRID1 = 40
GRID2 = 80
LISTSIZE = 65
SPAN = 1
NUM_CLS = 1
OBJ_THRESH = 0.3
NMS_THRESH_PERSON = 0.5
CLASSES_PERSON = ("Person",)
constant_matrix = np.array([[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]]).T

# ====================== MQTT ======================
MQTT_FIRE_TOPIC = 'fire/detection'
MQTT_PERSON_TOPIC = "atomo/store/person_detections"

MQTT_USERNAME = "rajat"
MQTT_PASSWORD = "asdf"

class MQTTManager:
    def __init__(self):
        self.client = mqtt_client.Client(client_id="combined_detector")
        self.client.on_connect = self._on_connect
        self.connected = False
        self.lock = threading.Lock()

    def _on_connect(self, client, userdata, flags, rc):
        self.connected = (rc == 0)
        print(f"[MQTT] {'Connected ✓' if self.connected else f'Failed rc={rc}'}")

    def start(self):
        self.client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        try:
            self.client.connect("localhost", 1883, 60)
            self.client.loop_start()
        except Exception as e:
            print(f"[MQTT] Connect error: {e}")

    def publish(self, topic, payload):
        if self.connected:
            with self.lock:
                if isinstance(payload, dict):
                    payload = json.dumps(payload)
                self.client.publish(topic, payload, qos=0)

mqtt_mgr = MQTTManager()

# ====================== EMAIL ALERTER ======================
class EmailAlerter:
    def __init__(self):
        self._last_sent = {}
        self._lock = threading.Lock()
        self._queue = queue.Queue()
        threading.Thread(target=self._send_loop, daemon=True).start()

    def _should_send(self, cam, cls):
        key = (cam, cls)
        now = time.time()
        with self._lock:
            if now - self._last_sent.get(key, 0) >= 60:
                self._last_sent[key] = now
                return True
        return False

    def alert(self, cam_name, cls_name, confidence, bbox, frame):
        if self._should_send(cam_name, cls_name):
            self._queue.put((cam_name, cls_name, confidence, bbox, frame.copy()))

    def _send_loop(self):
        while True:
            try:
                cam, cls, conf, bbox, frame = self._queue.get()
                self._send_email(cam, cls, conf, bbox, frame)
            except Exception as e:
                print(f"[EMAIL] Worker error: {e}")

    def _send_email(self, cam_name, cls_name, conf, bbox, frame):
        subject = f"[FIRE ALERT] {cls_name.upper()} detected on {cam_name}"
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        x1, y1, x2, y2 = bbox
        body_html = f"""
        <html><body style="font-family:Arial,sans-serif;background:#0d0d0d;color:#f0f0f0;padding:24px">
          <div style="max-width:600px;margin:auto;background:#1a1a1a;border-radius:12px;border:2px solid #ff4400;padding:24px">
            <h2 style="color:#ff4400;margin-top:0">🔥 FIRE DETECTION ALERT</h2>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:8px;color:#aaa">Camera</td><td style="padding:8px;color:#fff;font-weight:bold">{cam_name}</td></tr>
              <tr><td style="padding:8px;color:#aaa">Class</td><td style="padding:8px;color:#ff6600;font-weight:bold">{cls_name.upper()}</td></tr>
              <tr><td style="padding:8px;color:#aaa">Confidence</td><td style="padding:8px;color:#fff">{conf:.1%}</td></tr>
              <tr><td style="padding:8px;color:#aaa">Bounding Box</td><td style="padding:8px;color:#fff">[{x1}, {y1}, {x2}, {y2}]</td></tr>
              <tr><td style="padding:8px;color:#aaa">Timestamp</td><td style="padding:8px;color:#fff">{ts}</td></tr>
            </table>
            <p style="color:#888;font-size:12px;margin-top:16px">Automated alert from Combined Detection System</p>
          </div>
        </body></html>
        """
        _, img_buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        try:
            msg = MIMEMultipart('related')
            msg['Subject'] = subject
            msg['From'] = 'atomo.demo@gmail.com'
            msg['To'] = ', '.join(['palneha1912@gmail.com', 'miteshjoshi190@gmail.com'])
            alt = MIMEMultipart('alternative')
            alt.attach(MIMEText(body_html, 'html'))
            msg.attach(alt)
            img_part = MIMEImage(img_buf.tobytes(), name=f"alert_{cam_name}.jpg")
            img_part.add_header('Content-Disposition', 'attachment', filename=f"alert.jpg")
            msg.attach(img_part)
            context = ssl.create_default_context()
            with smtplib.SMTP('smtp.gmail.com', 587) as server:
                server.ehlo()
                server.starttls(context=context)
                server.login('atomo.demo@gmail.com', 'exlgsfnyfoeqeljk')
                server.sendmail('atomo.demo@gmail.com', ['palneha1912@gmail.com', 'miteshjoshi190@gmail.com'], msg.as_string())
            print(f"[EMAIL] Alert sent → {cam_name} | {cls_name}")
        except Exception as e:
            print(f"[EMAIL] Failed: {e}")

email_alerter = EmailAlerter()

# ====================== YOLOv3 HELPER FUNCTIONS ======================
def sigmoid(x):
    return 1 / (1 + np.exp(-x))

def softmax(x, axis=0):
    x = np.exp(x)
    return x / x.sum(axis=axis, keepdims=True)

def process(input_data):
    grid_h, grid_w = map(int, input_data.shape[0:2])
    box_class_probs = sigmoid(input_data[..., :NUM_CLS])
    box_0 = softmax(input_data[..., NUM_CLS:NUM_CLS+16], -1)
    box_1 = softmax(input_data[..., NUM_CLS+16:NUM_CLS+32], -1)
    box_2 = softmax(input_data[..., NUM_CLS+32:NUM_CLS+48], -1)
    box_3 = softmax(input_data[..., NUM_CLS+48:NUM_CLS+64], -1)
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

def filter_boxes(boxes, box_class_probs):
    box_classes = np.argmax(box_class_probs, axis=-1)
    box_class_scores = np.max(box_class_probs, axis=-1)
    pos = np.where(box_class_scores >= OBJ_THRESH)
    return boxes[pos], box_classes[pos], box_class_scores[pos]

def nms_boxes(boxes, scores):
    x1 = boxes[:, 0]; y1 = boxes[:, 1]; x2 = boxes[:, 2]; y2 = boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w1 = np.maximum(0.0, xx2 - xx1 + 0.00001)
        h1 = np.maximum(0.0, yy2 - yy1 + 0.00001)
        inter = w1 * h1
        ovr = inter / (areas[i] + areas[order[1:]] - inter)
        inds = np.where(ovr <= NMS_THRESH_PERSON)[0]
        order = order[inds + 1]
    return np.array(keep)

def yolov3_post_process(input_data):
    boxes_list, classes_list, scores_list = [], [], []
    for i in range(3):
        result, confidence = process(input_data[i])
        b, c, s = filter_boxes(result, confidence)
        boxes_list.append(b)
        classes_list.append(c)
        scores_list.append(s)
    boxes = np.concatenate(boxes_list)
    classes = np.concatenate(classes_list)
    scores = np.concatenate(scores_list)
    nboxes, nclasses, nscores = [], [], []
    for c in set(classes):
        inds = np.where(classes == c)
        b = boxes[inds]
        s = scores[inds]
        keep = nms_boxes(b, s)
        nboxes.append(b[keep])
        nclasses.append(classes[inds][keep])
        nscores.append(s[keep])
    if len(nboxes) == 0:
        return None, None, None
    return np.concatenate(nboxes), np.concatenate(nscores), np.concatenate(nclasses)

# ====================== COMBINED PIPELINE ======================
class CombinedPipeline:
    def __init__(self, cam_name: str, rtsp_url: str, save_dir=None):
        self.cam_name = cam_name
        self.rtsp_url = rtsp_url
        self.save_dir = save_dir
        self.frame_queue = queue.Queue(maxsize=2)
        self.stop_event = threading.Event()
        self._writer = None

        # Timers for throttling logs & MQTT
        self.last_publish_time = 0.0
        self.last_log_time_fire = 0.0
        self.last_log_time_person = 0.0

        if save_dir:
            os.makedirs(save_dir, exist_ok=True)
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            self._writer = cv2.VideoWriter(f"{save_dir}/{cam_name}.mp4", fourcc, 15.0, (WIDTH, HEIGHT))

    def start(self):
        threading.Thread(target=self._rtsp_loop, daemon=True).start()
        threading.Thread(target=self._inference_loop, daemon=True).start()

    def _rtsp_loop(self):
        frame_size = WIDTH * HEIGHT * 3
        while not self.stop_event.is_set():
            cmd = ["ffmpeg", "-rtsp_transport", "tcp", "-i", self.rtsp_url,
                   "-f", "rawvideo", "-pix_fmt", "bgr24",
                   "-vf", f"scale={WIDTH}:{HEIGHT}", "-an", "-sn",
                   "-loglevel", "quiet", "pipe:1"]
            try:
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                while not self.stop_event.is_set():
                    raw = proc.stdout.read(frame_size)
                    if len(raw) != frame_size:
                        break
                    frame = np.frombuffer(raw, dtype=np.uint8).reshape((HEIGHT, WIDTH, 3))
                    if self.frame_queue.full():
                        try: self.frame_queue.get_nowait()
                        except: pass
                    self.frame_queue.put(frame)
            except Exception as e:
                print(f"[{self.cam_name}] RTSP error: {e}")
            finally:
                try: proc.kill()
                except: pass
            if not self.stop_event.is_set():
                time.sleep(RECONNECT_DELAY)

    def _inference_loop(self):
        # Load Fire Model
        self.net = cv2.dnn.readNet(MODEL_PATH)
        self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_TIMVX)
        self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_NPU)
        print(f"[{self.cam_name}] Fire model loaded on NPU ✓")

        # Load Person Model
        self.yolov3 = asnn('Electron')
        self.yolov3.nn_init(library=args.library, model=args.model, level=0)
        print(f"[{self.cam_name}] Person model loaded ✓")

        while not self.stop_event.is_set():
            try:
                frame = self.frame_queue.get(timeout=1.0)
            except queue.Empty:
                continue

            ts = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

            # ------------------- FIRE DETECTION -------------------
            fire_detections = []
            blob = cv2.dnn.blobFromImage(frame, 1/255.0, (INPUT_SIZE, INPUT_SIZE), swapRB=True, crop=False)
            self.net.setInput(blob)
            outputs = np.squeeze(self.net.forward()).T

            boxes_f, scores_f, class_ids_f = [], [], []
            for pred in outputs:
                confs = pred[4:]
                class_id = int(np.argmax(confs))
                confidence = float(confs[class_id])
                if confidence < CONF_THRESH:
                    continue

                cx, cy, bw, bh = pred[:4]
                cx = int(cx / INPUT_SIZE * WIDTH)
                cy = int(cy / INPUT_SIZE * HEIGHT)
                bw = int(bw / INPUT_SIZE * WIDTH)
                bh = int(bh / INPUT_SIZE * HEIGHT)
                x1 = int(cx - bw / 2)
                y1 = int(cy - bh / 2)
                x2 = int(cx + bw / 2)
                y2 = int(cy + bh / 2)

                area = bw * bh
                aspect_ratio = bw / bh if bh > 0 else 0

                # Additional filters to reduce TV false positives
                if area < MIN_FIRE_AREA or aspect_ratio > MAX_ASPECT_RATIO:
                    continue

                boxes_f.append([x1, y1, x2 - x1, y2 - y1])
                scores_f.append(confidence)
                class_ids_f.append(class_id)

            keep = cv2.dnn.NMSBoxes(boxes_f, scores_f, CONF_THRESH, NMS_THRESH) if boxes_f else []
            
            # Convert keep to list if it's not empty
            if isinstance(keep, np.ndarray):
                keep = keep.flatten().tolist()
            elif isinstance(keep, tuple):
                keep = list(keep)
            
            for i in keep:
                x, y, bw, bh = boxes_f[i]
                x1 = x
                y1 = y
                x2 = x + bw
                y2 = y + bh
                cls_name = CLASSES_FIRE[class_ids_f[i]] if class_ids_f[i] < len(CLASSES_FIRE) else str(class_ids_f[i])
                conf = scores_f[i]

                fire_detections.append({
                    "class": cls_name,
                    "confidence": round(float(conf), 3),
                    "bbox": [int(x1), int(y1), int(x2), int(y2)]  # Flat bbox as list of ints
                })

                email_alerter.alert(self.cam_name, cls_name, conf, [int(x1), int(y1), int(x2), int(y2)], frame)

                # Log when fire is detected (throttled)
                now = time.time()
                if now - self.last_log_time_fire >= 2.0:
                    self.last_log_time_fire = now
                    print(f"[{self.cam_name}] 🔥 FIRE DETECTED | Conf: {conf:.1%} | BBox: [{int(x1)},{int(y1)},{int(x2)},{int(y2)}] | Area: {bw*bh} | {ts}")

            # ------------------- PERSON DETECTION -------------------
            detections = []
            img = cv2.resize(frame, (640, 640)).astype(np.float32)
            img = img / 255.0
            img = img.transpose(2, 0, 1)

            data = self.yolov3.nn_inference(
                [img],
                platform='ONNX',
                reorder='2 1 0',
                output_tensor=3,
                output_format=output_format.OUT_FORMAT_FLOAT32
            )

            input0 = data[2].reshape(SPAN, LISTSIZE, GRID0, GRID0)
            input1 = data[1].reshape(SPAN, LISTSIZE, GRID1, GRID1)
            input2 = data[0].reshape(SPAN, LISTSIZE, GRID2, GRID2)

            input_data = [
                np.transpose(input0, (2, 3, 0, 1)),
                np.transpose(input1, (2, 3, 0, 1)),
                np.transpose(input2, (2, 3, 0, 1)),
            ]

            boxes_p, scores_p, classes_p = yolov3_post_process(input_data)

            if boxes_p is not None:
                h, w = frame.shape[:2]
                for idx, (box, score, cl) in enumerate(zip(boxes_p, scores_p, classes_p)):
                    x1 = max(0, int(box[0] * w))
                    y1 = max(0, int(box[1] * h))
                    x2 = min(w, int(box[2] * w))
                    y2 = min(h, int(box[3] * h))

                    detections.append({
                        "detection_id": idx,
                        "class": CLASSES_PERSON[cl],
                        "confidence": round(float(score), 3),
                        "bbox": [int(x1), int(y1), int(x2), int(y2)]  # Flat bbox as list of ints
                    })

            # Log when person is detected (throttled)
            now = time.time()
            if detections and now - self.last_log_time_person >= 2.0:
                self.last_log_time_person = now
                print(f"[{self.cam_name}] 👤 PERSON DETECTED: {len(detections)} person(s) | {datetime.now().strftime('%H:%M:%S')}")

            # ------------------- MQTT EVERY SECOND -------------------
            now = time.time()
            if now - self.last_publish_time >= 1.0:
                self.last_publish_time = now
                ts_iso = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

                # Fire MQTT payload with flat bbox
                fire_payload = {
                    "camera": self.cam_name,
                    "timestamp": ts_iso,
                    "detection_count": len(fire_detections),
                    "detections": fire_detections  # Already has flat bbox
                }
                mqtt_mgr.publish(MQTT_FIRE_TOPIC, fire_payload)

                # Person MQTT payload with flat bbox
                person_payload = {
                    "timestamp": time.time(),
                    "datetime": datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
                    "camera_id": self.cam_name,
                    "detection_count": len(detections),
                    "detections": detections,  # Already has flat bbox
                }
                mqtt_mgr.publish(MQTT_PERSON_TOPIC, person_payload)

            # Save frame
            if self._writer:
                self._writer.write(frame)

    def stop(self):
        self.stop_event.set()
        if self._writer:
            self._writer.release()

# ====================== MAIN ======================
def main():
    mqtt_mgr.start()
    time.sleep(1.5)

    pipelines = []
    for name, url in CAMERAS:
        p = CombinedPipeline(name, url, args.save)
        p.start()
        pipelines.append(p)

    print(f"\n=== Combined Fire + Person Detection Started ===")
    print(f"Cameras: {len(CAMERAS)} | Fire CONF_THRESH: {CONF_THRESH} | Min Area: {MIN_FIRE_AREA}")
    print("MQTT publishes every second (0 when no detection)")
    print("Person bbox now sent as flat [x1, y1, x2, y2]")
    print("Fire bbox now sent as flat [x1, y1, x2, y2]")
    print("Fire false positives on TV significantly reduced\n")
    print("Press Ctrl+C to stop\n")

    try:
        while True:
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        for p in pipelines:
            p.stop()
        mqtt_mgr.client.loop_stop()
        mqtt_mgr.client.disconnect()
        print("Cleanup complete.")

if __name__ == "__main__":
    main()
