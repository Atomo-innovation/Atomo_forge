#!/usr/bin/env python3
"""
fire.py — Fire detection reading from the shared FrameBroker.
NO direct RTSP connection here. Import shared_stream and read from its queues.
"""

# ─── import the broker (must be in same directory or PYTHONPATH) ──
from shared_stream import brokers, start_all, stop_all, CAMERAS

import cv2
import numpy as np
import threading
import queue
import time
import json
import argparse
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.image import MIMEImage
from datetime import datetime
import paho.mqtt.client as mqtt_client

parser = argparse.ArgumentParser(description="Fire detection via shared frame broker")
parser.add_argument('--display',  action='store_true')
parser.add_argument('--save',     type=str, default=None)
parser.add_argument('--headless', action='store_true')
args = parser.parse_args()

# ─── MODEL CONFIG ─────────────────────────────────────────
MODEL_PATH  = "fire.onnx"
INPUT_SIZE  = 640
CONF_THRESH = 0.5
NMS_THRESH  = 0.5
WIDTH       = 640
HEIGHT      = 480

FIRE_CLASSES = ["fire", "smoke"]
CLASSES      = ["fire", "FIRE"]

np.random.seed(7)
COLORS = {
    "fire":  (0,  60, 255),
    "FIRE": (150, 150, 150),
}
DEFAULT_COLOR = (0, 200, 255)

# ─── SMTP CONFIG ──────────────────────────────────────────
SMTP_SERVER            = 'smtp.gmail.com'
SMTP_PORT              = 587
EMAIL_FROM             = 'atomo.demo@gmail.com'
EMAIL_PASSWORD         = 'exlgsfnyfoeqeljk'
TO_EMAILS              = ['palneha1912@gmail.com', 'miteshjoshi190@gmail.com']
EMAIL_SUBJECT_TEMPLATE = "[FIRE ALERT] {class_name} detected on {camera}"
EMAIL_COOLDOWN_SEC     = 60

# ─── MQTT CONFIG ──────────────────────────────────────────
MQTT_BROKER     = 'localhost'
MQTT_PORT_MQTT  = 1883
MQTT_FIRE_TOPIC = 'fire/detection'


# ──────────────────────────────────────────────────────────
#  MQTT (same as original)
# ──────────────────────────────────────────────────────────
class MQTTManager:
    def __init__(self):
        self._client = mqtt_client.Client(client_id="fire_detector", clean_session=True)
        self._client.on_connect    = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._connected = False
        self._lock = threading.Lock()

    def _on_connect(self, client, userdata, flags, rc):
        self._connected = (rc == 0)
        print(f"[MQTT-Fire] {'Connected' if self._connected else f'Failed rc={rc}'}")

    def _on_disconnect(self, client, userdata, rc):
        self._connected = False

    def start(self):
        try:
            self._client.connect(MQTT_BROKER, MQTT_PORT_MQTT, keepalive=60)
            self._client.loop_start()
        except Exception as e:
            print(f"[MQTT-Fire] Could not connect: {e}")

    def publish(self, topic, payload):
        with self._lock:
            if self._connected:
                self._client.publish(topic, payload)

    def stop(self):
        self._client.loop_stop()
        self._client.disconnect()


mqtt_mgr = MQTTManager()


# ──────────────────────────────────────────────────────────
#  Email alerter (unchanged from original)
# ──────────────────────────────────────────────────────────
class EmailAlerter:
    def __init__(self):
        self._last_sent: dict = {}
        self._lock   = threading.Lock()
        self._queue  = queue.Queue()
        threading.Thread(target=self._send_loop, daemon=True).start()

    def _should_send(self, cam, cls):
        key = (cam, cls)
        now = time.time()
        with self._lock:
            if now - self._last_sent.get(key, 0) >= EMAIL_COOLDOWN_SEC:
                self._last_sent[key] = now
                return True
        return False

    def alert(self, cam_name, cls_name, confidence, bbox, frame):
        if self._should_send(cam_name, cls_name):
            self._queue.put((cam_name, cls_name, confidence, bbox, frame.copy()))

    def _send_loop(self):
        while True:
            try:
                args = self._queue.get()
                self._send_email(*args)
            except Exception as e:
                print(f"[EMAIL] Error: {e}")

    def _send_email(self, cam_name, cls_name, conf, bbox, frame):
        subject = EMAIL_SUBJECT_TEMPLATE.format(
            class_name=cls_name.upper(), camera=cam_name
        )
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        x1, y1, x2, y2 = bbox
        body_html = f"""
        <html><body style="font-family:Arial,sans-serif;background:#0d0d0d;color:#f0f0f0;padding:24px">
          <div style="max-width:600px;margin:auto;background:#1a1a1a;border-radius:12px;
                      border:2px solid #ff4400;padding:24px">
            <h2 style="color:#ff4400;margin-top:0">FIRE DETECTION ALERT</h2>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:8px;color:#aaa">Camera</td>
                  <td style="padding:8px;color:#fff;font-weight:bold">{cam_name}</td></tr>
              <tr><td style="padding:8px;color:#aaa">Class</td>
                  <td style="padding:8px;color:#ff6600;font-weight:bold">{cls_name.upper()}</td></tr>
              <tr><td style="padding:8px;color:#aaa">Confidence</td>
                  <td style="padding:8px;color:#fff">{conf:.1%}</td></tr>
              <tr><td style="padding:8px;color:#aaa">Bounding Box</td>
                  <td style="padding:8px;color:#fff">[{x1}, {y1}, {x2}, {y2}]</td></tr>
              <tr><td style="padding:8px;color:#aaa">Timestamp</td>
                  <td style="padding:8px;color:#fff">{ts}</td></tr>
            </table>
          </div>
        </body></html>
        """
        _, img_buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        img_bytes  = img_buf.tobytes()
        try:
            msg = MIMEMultipart('related')
            msg['Subject'] = subject
            msg['From']    = EMAIL_FROM
            msg['To']      = ', '.join(TO_EMAILS)
            alt = MIMEMultipart('alternative')
            alt.attach(MIMEText(body_html, 'html'))
            img_attach = MIMEImage(img_bytes, _subtype='jpeg')
            img_attach.add_header('Content-Disposition', 'attachment',
                                  filename=f'fire_{cam_name}_{ts}.jpg')
            msg.attach(alt)
            msg.attach(img_attach)
            ctx = ssl.create_default_context()
            with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as srv:
                srv.ehlo()
                srv.starttls(context=ctx)
                srv.login(EMAIL_FROM, EMAIL_PASSWORD)
                srv.sendmail(EMAIL_FROM, TO_EMAILS, msg.as_string())
            print(f"[EMAIL] Alert sent for {cam_name} — {cls_name}")
        except Exception as e:
            print(f"[EMAIL] Send failed: {e}")


email_alerter = EmailAlerter()


# ──────────────────────────────────────────────────────────
#  ONNX inference (unchanged logic, operates on frames from broker)
# ──────────────────────────────────────────────────────────
def load_model():
    net = cv2.dnn.readNetFromONNX(MODEL_PATH)
    net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
    net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
    return net


def infer(net, frame):
    blob = cv2.dnn.blobFromImage(
        frame, 1/255.0, (INPUT_SIZE, INPUT_SIZE),
        swapRB=True, crop=False
    )
    net.setInput(blob)
    return net.forward()


def postprocess(output, frame_shape):
    h, w = frame_shape[:2]
    preds = output[0] if output.ndim == 3 else output
    boxes, scores, class_ids = [], [], []
    for pred in preds:
        confs = pred[4:]
        class_id   = int(np.argmax(confs))
        confidence = float(confs[class_id])
        if confidence < CONF_THRESH:
            continue
        cx, cy, bw, bh = pred[:4]
        cx = cx / INPUT_SIZE * w; cy = cy / INPUT_SIZE * h
        bw = bw / INPUT_SIZE * w; bh = bh / INPUT_SIZE * h
        x1 = int(cx - bw / 2); y1 = int(cy - bh / 2)
        x2 = int(cx + bw / 2); y2 = int(cy + bh / 2)
        boxes.append([x1, y1, x2 - x1, y2 - y1])
        scores.append(confidence)
        class_ids.append(class_id)

    keep = cv2.dnn.NMSBoxes(boxes, scores, CONF_THRESH, NMS_THRESH)
    keep = list(keep) if len(keep) > 0 else []
    return boxes, scores, class_ids, keep


def draw_and_publish(frame, boxes, scores, class_ids, keep, cam_name):
    ts = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    vis = frame.copy()
    for i in keep:
        x, y, bw, bh = boxes[i]
        x1, y1, x2, y2 = x, y, x + bw, y + bh
        cls_name = CLASSES[class_ids[i]] if class_ids[i] < len(CLASSES) else str(class_ids[i])
        conf     = scores[i]
        color    = COLORS.get(cls_name, DEFAULT_COLOR)
        label    = f"{cls_name.upper()}: {conf:.2f}"

        cv2.rectangle(vis, (x1, y1), (x2, y2), color, 2)
        (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        cv2.rectangle(vis, (x1, y1 - lh - 12), (x1 + lw + 6, y1), color, -1)
        cv2.putText(vis, label, (x1 + 3, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        data = {
            "camera": cam_name, "class": cls_name,
            "confidence": round(float(conf), 3),
            "bbox": [x1, y1, x2, y2], "timestamp": ts
        }
        mqtt_mgr.publish(MQTT_FIRE_TOPIC, json.dumps(data))
        email_alerter.alert(cam_name, cls_name, conf, [x1, y1, x2, y2], frame)

    cv2.putText(vis, f"Dets: {len(keep)}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    cv2.putText(vis, cam_name, (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 2)
    return vis


# ──────────────────────────────────────────────────────────
#  Per-camera inference worker (reads from broker queue)
# ──────────────────────────────────────────────────────────
def camera_worker(cam_id: str, broker):
    """Each camera gets its own thread + its own net instance (thread-safe)."""
    net = load_model()
    print(f"[Fire:{cam_id}] Inference worker ready")
    while True:
        try:
            frame = broker.fire_queue.get(timeout=1.0)
        except queue.Empty:
            continue

        output     = infer(net, frame)
        boxes, scores, class_ids, keep = postprocess(output, frame.shape)
        vis = draw_and_publish(frame, boxes, scores, class_ids, keep, cam_id)

        # Push annotated frame back to broker so MediaMTX gets it overlaid
        broker.update_overlay(vis)

        if args.display:
            cv2.imshow(f"Fire — {cam_id}", vis)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break


# ──────────────────────────────────────────────────────────
#  MAIN
# ──────────────────────────────────────────────────────────
def main():
    mqtt_mgr.start()
    time.sleep(0.5)

    # Broker must already be started by the launcher (run.py), but
    # if you run fire.py standalone it will start the broker itself.
    if not brokers:
        print("[Fire] Starting shared frame broker...")
        start_all()
        time.sleep(1)

    threads = []
    for cam_id, broker in brokers.items():
        t = threading.Thread(target=camera_worker, args=(cam_id, broker), daemon=True)
        t.start()
        threads.append(t)

    print(f"[Fire] Running on {len(brokers)} cameras. Ctrl-C to stop.")
    if args.display:
        for t in threads:
            t.join()
    else:
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass

    mqtt_mgr.stop()
    if args.display:
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
