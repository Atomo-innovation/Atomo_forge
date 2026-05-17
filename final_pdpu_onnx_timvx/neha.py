#!/usr/bin/env python3
"""
Real-Time Combined Fire + Person Detection
- Single efficient RTSP stream per camera
- Both models run on the latest frame in real-time
- Optimized for low latency and high FPS
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
parser = argparse.ArgumentParser(description="Real-Time Fire + Person Detection")
parser.add_argument('--display', action='store_true', help='Show live windows')
parser.add_argument('--save', type=str, default=None, help='Directory to save videos')
parser.add_argument('--library', required=True, help='Path to ASNN library (.so)')
parser.add_argument('--model', required=True, help='Path to ASNN .nbg model')
args = parser.parse_args()

# ====================== CAMERA CONFIG ======================
CAMERAS = [
    ("workstation", "rtsp://admin:Admin@123@10.30.41.161:554/profile2/media.smp"),
    ("pdpu",        "rtsp://admin:Admin@123@10.30.41.142:554/profile2/media.smp")
]

WIDTH = 640
HEIGHT = 480
RECONNECT_DELAY = 3

# ====================== FIRE CONFIG ======================
MODEL_PATH = "fire.onnx"
INPUT_SIZE = 640
CONF_THRESH = 0.5
NMS_THRESH = 0.5
CLASSES_FIRE = ["fire", "FIRE"]

# SMTP
SMTP_SERVER = 'smtp.gmail.com'
SMTP_PORT = 587
EMAIL_FROM = 'atomo.demo@gmail.com'
EMAIL_PASSWORD = 'exlgsfnyfoeqeljk'
TO_EMAILS = ['palneha1912@gmail.com', 'miteshjoshi190@gmail.com']
EMAIL_COOLDOWN_SEC = 60

MQTT_FIRE_TOPIC = 'fire/detection'

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

MQTT_PERSON_TOPIC = "atomo/store/person_detections"

# ====================== MQTT MANAGER ======================
class MQTTManager:
    def __init__(self):
        self.client = mqtt_client.Client(client_id="realtime_combined")
        self.client.on_connect = lambda c, u, f, rc: setattr(self, 'connected', rc == 0)
        self.connected = False
        self.lock = threading.Lock()

    def start(self):
        self.client.username_pw_set("rajat", "asdf")
        try:
            self.client.connect("10.30.64.48", 1883, 60)
            self.client.loop_start()
            print("[MQTT] Connecting...")
        except Exception as e:
            print(f"[MQTT] Error: {e}")

    def publish(self, topic, payload):
        if self.connected:
            with self.lock:
                data = json.dumps(payload) if isinstance(payload, dict) else str(payload)
                self.client.publish(topic, data, qos=0)

mqtt_mgr = MQTTManager()

# ====================== EMAIL ALERTER ======================
class EmailAlerter:
    def __init__(self):
        self._last_sent = {}
        self._lock = threading.Lock()
        self._queue = queue.Queue(maxsize=10)
        threading.Thread(target=self._worker, daemon=True).start()

    def _should_send(self, cam, cls_name):
        key = (cam, cls_name)
        now = time.time()
        with self._lock:
            if now - self._last_sent.get(key, 0) >= EMAIL_COOLDOWN_SEC:
                self._last_sent[key] = now
                return True
        return False

    def alert(self, cam_name, cls_name, conf, bbox, frame):
        if self._should_send(cam_name, cls_name):
            try:
                self._queue.put_nowait((cam_name, cls_name, conf, bbox, frame.copy()))
            except queue.Full:
                pass

    def _worker(self):
        while True:
            try:
                cam, cls, conf, bbox, frame = self._queue.get(timeout=2)
                self._send(cam, cls, conf, bbox, frame)
            except:
                pass

    def _send(self, cam_name, cls_name, conf, bbox, frame):
        subject = f"[FIRE ALERT] {cls_name.upper()} on {cam_name}"
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        x1, y1, x2, y2 = bbox

        body_html = f"""
        <html><body style="font-family:Arial;background:#111;color:#eee;padding:20px">
        <div style="background:#1f1f1f;padding:20px;border-radius:10px;border:2px solid #f44">
        <h2>🔥 FIRE ALERT</h2>
        <p><b>Camera:</b> {cam_name}</p>
        <p><b>Class:</b> {cls_name.upper()}</p>
        <p><b>Confidence:</b> {conf:.1%}</p>
        <p><b>Time:</b> {ts}</p>
        </div></body></html>"""

        _, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        try:
            msg = MIMEMultipart('related')
            msg['Subject'] = subject
            msg['From'] = EMAIL_FROM
            msg['To'] = ', '.join(TO_EMAILS)
            msg.attach(MIMEMultipart('alternative').attach(MIMEText(body_html, 'html')))
            msg.attach(MIMEImage(buf.tobytes(), name="alert.jpg"))
            
            context = ssl.create_default_context()
            with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
                server.starttls(context=context)
                server.login(EMAIL_FROM, EMAIL_PASSWORD)
                server.sendmail(EMAIL_FROM, TO_EMAILS, msg.as_string())
            print(f"[EMAIL] Sent: {cam_name} - {cls_name}")
        except Exception as e:
            print(f"[EMAIL] Failed: {e}")

email_alerter = EmailAlerter()

# ====================== YOLOV3 POST-PROCESSING ======================
def sigmoid(x): return 1 / (1 + np.exp(-x))
def softmax(x, axis=0):
    e = np.exp(x)
    return e / e.sum(axis=axis, keepdims=True)

def process_yolo(input_data):
    grid_h, grid_w = input_data.shape[:2]
    probs = sigmoid(input_data[..., :NUM_CLS])
    b0 = softmax(input_data[..., NUM_CLS:NUM_CLS+16], -1)
    b1 = softmax(input_data[..., NUM_CLS+16:NUM_CLS+32], -1)
    b2 = softmax(input_data[..., NUM_CLS+32:NUM_CLS+48], -1)
    b3 = softmax(input_data[..., NUM_CLS+48:NUM_CLS+64], -1)

    result = np.zeros((grid_h, grid_w, 1, 4))
    result[...,0] = np.dot(b0, constant_matrix)[...,0]
    result[...,1] = np.dot(b1, constant_matrix)[...,0]
    result[...,2] = np.dot(b2, constant_matrix)[...,0]
    result[...,3] = np.dot(b3, constant_matrix)[...,0]

    col = np.tile(np.arange(grid_w), grid_w).reshape(-1, grid_w)
    row = np.tile(np.arange(grid_h).reshape(-1,1), grid_h)
    grid = np.concatenate([col.reshape(grid_h,grid_w,1,1), row.reshape(grid_h,grid_w,1,1)], axis=-1)

    result[...,:2] = (0.5 - result[...,:2] + grid) / (grid_w, grid_h)
    result[...,2:4] = (0.5 + result[...,2:4] + grid) / (grid_w, grid_h)
    return result, probs

def filter_yolo(boxes, probs):
    cls = np.argmax(probs, axis=-1)
    scores = np.max(probs, axis=-1)
    pos = scores >= OBJ_THRESH
    return boxes[pos], cls[pos], scores[pos]

def nms_yolo(boxes, scores):
    if len(scores) == 0: return np.array([])
    x1,y1,x2,y2 = boxes[:,0], boxes[:,1], boxes[:,2], boxes[:,3]
    areas = (x2-x1)*(y2-y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        if len(order) == 1: break
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0, xx2-xx1)
        h = np.maximum(0, yy2-yy1)
        ovr = (w*h) / (areas[i] + areas[order[1:]] - w*h)
        order = order[1:][ovr <= NMS_THRESH_PERSON]
    return np.array(keep)

def yolov3_post_process(input_data):
    boxes_all, cls_all, scores_all = [], [], []
    for inp in input_data:
        res, probs = process_yolo(inp)
        b, c, s = filter_yolo(res, probs)
        boxes_all.append(b)
        cls_all.append(c)
        scores_all.append(s)

    if not boxes_all: return None, None, None

    boxes = np.concatenate(boxes_all)
    classes = np.concatenate(cls_all)
    scores = np.concatenate(scores_all)

    final_boxes, final_cls, final_scores = [], [], []
    for c in set(classes):
        idx = classes == c
        keep = nms_yolo(boxes[idx], scores[idx])
        final_boxes.append(boxes[idx][keep])
        final_cls.append(classes[idx][keep])
        final_scores.append(scores[idx][keep])

    return np.concatenate(final_boxes), np.concatenate(final_scores), np.concatenate(final_cls)

# ====================== PIPELINE ======================
class RealTimePipeline:
    def __init__(self, cam_name, rtsp_url, save_dir=None):
        self.cam_name = cam_name
        self.rtsp_url = rtsp_url
        self.save_dir = save_dir
        self.latest_frame = None
        self.frame_lock = threading.Lock()
        self.stop_event = threading.Event()
        self.net = None
        self.yolov3 = None
        self._writer = None

        if save_dir:
            os.makedirs(save_dir, exist_ok=True)
            self._writer = cv2.VideoWriter(f"{save_dir}/{cam_name}.mp4",
                                           cv2.VideoWriter_fourcc(*'mp4v'), 15, (WIDTH, HEIGHT))

    def start(self):
        threading.Thread(target=self._rtsp_reader, daemon=True).start()
        threading.Thread(target=self._inference_loop, daemon=True).start()

    def _rtsp_reader(self):
        frame_size = WIDTH * HEIGHT * 3
        while not self.stop_event.is_set():
            cmd = ["ffmpeg", "-rtsp_transport", "tcp", "-i", self.rtsp_url,
                   "-f", "rawvideo", "-pix_fmt", "bgr24",
                   "-vf", f"scale={WIDTH}:{HEIGHT}", "-an", "-sn", "-loglevel", "quiet", "pipe:1"]

            try:
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                while not self.stop_event.is_set():
                    raw = proc.stdout.read(frame_size)
                    if len(raw) != frame_size:
                        break
                    frame = np.frombuffer(raw, np.uint8).reshape(HEIGHT, WIDTH, 3)
                    with self.frame_lock:
                        self.latest_frame = frame.copy()
            except:
                pass
            finally:
                try: proc.kill()
                except: pass
            if not self.stop_event.is_set():
                time.sleep(RECONNECT_DELAY)

    def _inference_loop(self):
        # Load models
        self.net = cv2.dnn.readNet(MODEL_PATH)
        self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_TIMVX)
        self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_NPU)

        self.yolov3 = asnn('Electron')
        self.yolov3.nn_init(library=args.library, model=args.model, level=0)

        print(f"[{self.cam_name}] Both models loaded - Running in real-time")

        last_time = time.time()

        while not self.stop_event.is_set():
            with self.frame_lock:
                if self.latest_frame is None:
                    time.sleep(0.01)
                    continue
                frame = self.latest_frame.copy()

            # FPS calculation
            fps = 1.0 / max(time.time() - last_time, 0.001)
            last_time = time.time()

            ts = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

            # === FIRE DETECTION ===
            blob = cv2.dnn.blobFromImage(frame, 1/255.0, (INPUT_SIZE, INPUT_SIZE), swapRB=True, crop=False)
            self.net.setInput(blob)
            outputs = np.squeeze(self.net.forward()).T

            boxes_f, scores_f, ids_f = [], [], []
            for pred in outputs:
                confs = pred[4:]
                cid = int(np.argmax(confs))
                conf = float(confs[cid])
                if conf < CONF_THRESH: continue

                cx,cy,bw,bh = pred[:4]
                x1 = int((cx - bw/2) * WIDTH / INPUT_SIZE)
                y1 = int((cy - bh/2) * HEIGHT / INPUT_SIZE)
                x2 = int((cx + bw/2) * WIDTH / INPUT_SIZE)
                y2 = int((cy + bh/2) * HEIGHT / INPUT_SIZE)

                boxes_f.append([x1, y1, x2-x1, y2-y1])
                scores_f.append(conf)
                ids_f.append(cid)

            keep = cv2.dnn.NMSBoxes(boxes_f, scores_f, CONF_THRESH, NMS_THRESH) if boxes_f else []
            for i in keep:
                x,y,w,h = boxes_f[i]
                cls_name = CLASSES_FIRE[ids_f[i]] if ids_f[i] < len(CLASSES_FIRE) else "fire"
                conf = scores_f[i]

                mqtt_mgr.publish(MQTT_FIRE_TOPIC, {
                    "camera": self.cam_name, "class": cls_name,
                    "confidence": round(conf, 3), "bbox": [x, y, x+w, y+h], "timestamp": ts
                })

                email_alerter.alert(self.cam_name, cls_name, conf, [x, y, x+w, y+h], frame)

            # === PERSON DETECTION ===
            img = cv2.resize(frame, (640, 640)).astype(np.float32) / 255.0
            img = img.transpose(2, 0, 1)

            data = self.yolov3.nn_inference([img], platform='ONNX', reorder='2 1 0',
                                            output_tensor=3, output_format=output_format.OUT_FORMAT_FLOAT32)

            input_data = [
                np.transpose(data[2].reshape(SPAN, LISTSIZE, GRID0, GRID0), (2,3,0,1)),
                np.transpose(data[1].reshape(SPAN, LISTSIZE, GRID1, GRID1), (2,3,0,1)),
                np.transpose(data[0].reshape(SPAN, LISTSIZE, GRID2, GRID2), (2,3,0,1))
            ]

            boxes_p, scores_p, classes_p = yolov3_post_process(input_data)

            detections = []
            if boxes_p is not None:
                h, w = frame.shape[:2]
                for i, (box, score, cl) in enumerate(zip(boxes_p, scores_p, classes_p)):
                    x1 = max(0, int(box[0]*w))
                    y1 = max(0, int(box[1]*h))
                    x2 = min(w, int(box[2]*w))
                    y2 = min(h, int(box[3]*h))
                    detections.append({
                        "detection_id": i,
                        "class": "Person",
                        "confidence": float(score),
                        "bbox": {"x1":x1,"y1":y1,"x2":x2,"y2":y2,"center_x":(x1+x2)//2,"center_y":(y1+y2)//2},
                        "gender": {"label":"Unknown","id":-1,"confidence":0.0}
                    })

            if detections:
                mqtt_mgr.publish(MQTT_PERSON_TOPIC, {
                    "timestamp": time.time(),
                    "datetime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "camera_id": self.cam_name,
                    "detection_count": len(detections),
                    "detections": detections
                })

            # Save & Display
            if self._writer:
                self._writer.write(frame)

            if args.display:
                vis = frame.copy()
                cv2.putText(vis, f"FPS: {fps:.1f} | {self.cam_name}", (10, 30),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,255,0), 2)
                cv2.imshow(self.cam_name, vis)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    self.stop_event.set()

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
        p = RealTimePipeline(name, url, args.save)
        p.start()
        pipelines.append(p)

    print("=== Real-Time Combined Fire + Person Detection Started ===")
    print(f"Cameras: {len(CAMERAS)} | Display: {'ON' if args.display else 'OFF'}")

    try:
        while True:
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        for p in pipelines:
            p.stop()
        mqtt_mgr.client.loop_stop()
        mqtt_mgr.client.disconnect()
        if args.display:
            cv2.destroyAllWindows()
        print("All threads stopped.")

if __name__ == "__main__":
    main()
