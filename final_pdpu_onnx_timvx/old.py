#!/usr/bin/env python3
"""
Multi-Camera Fire Detection with MQTT + SMTP Alerts
Supports multiple RTSP streams, YOLOv8 ONNX inference on NPU,
MQTT publishing of bounding box data, and real-time email alerts.
"""

import cv2
import numpy as np
import threading
import queue
import subprocess
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

# ─── ARGS ─────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Multi-RTSP Fire Detection with MQTT & SMTP")
parser.add_argument('--display', action='store_true', help='Show imshow windows')
parser.add_argument('--save',    type=str, default=None, help='Directory to save output videos')
parser.add_argument('--headless', action='store_true', help='Run without display (default)')
args = parser.parse_args()
# ──────────────────────────────────────────────────────────

# ─── CAMERA CONFIG ────────────────────────────────────────
# Add / remove cameras here. Each entry: (name, rtsp_url)
CAMERAS = [
    ("workstation", "rtsp://admin:Admin@123@10.30.41.161:554/profile2/media.smp"),
    ("pdpu", "rtsp://admin:Admin@123@10.30.41.142:554/profile2/media.smp")
]
# ──────────────────────────────────────────────────────────

# ─── MODEL CONFIG ─────────────────────────────────────────
MODEL_PATH  = "fire.onnx"   # Your fire detection ONNX model
INPUT_SIZE  = 640
CONF_THRESH = 0.5
NMS_THRESH  = 0.5
WIDTH       = 640
HEIGHT      = 480
RECONNECT_DELAY = 5

# Fire / smoke class names from your model
# Adjust these to match your model's class labels exactly
FIRE_CLASSES = ["fire", "smoke"]

# All class names in your model (index → name)
CLASSES = ["fire", "FIRE"]   # ← update if your model has more classes

np.random.seed(7)
COLORS = {
    "fire":  (0,   60,  255),   # deep red-orange  (BGR)
    "FIRE": (150, 150, 150),   # grey
}
DEFAULT_COLOR = (0, 200, 255)
# ──────────────────────────────────────────────────────────

# ─── SMTP CONFIG ──────────────────────────────────────────
SMTP_SERVER   = 'smtp.gmail.com'
SMTP_PORT     = 587
EMAIL_FROM    = 'atomo.demo@gmail.com'
EMAIL_PASSWORD = 'exlgsfnyfoeqeljk'   # App Password
TO_EMAILS     = ['palneha1912@gmail.com', 'miteshjoshi190@gmail.com']
EMAIL_SUBJECT_TEMPLATE = "[FIRE ALERT] {class_name} detected on {camera}"

# Cooldown: only send one email per camera per class every N seconds
EMAIL_COOLDOWN_SEC = 60
# ──────────────────────────────────────────────────────────

# ─── MQTT CONFIG ──────────────────────────────────────────
MQTT_BROKER     = 'localhost'
MQTT_PORT       = 1883
MQTT_FIRE_TOPIC = 'fire/detection'
# ──────────────────────────────────────────────────────────


# ══════════════════════════════════════════════════════════
#  MQTT CLIENT (shared across all cameras)
# ══════════════════════════════════════════════════════════
class MQTTManager:
    def __init__(self):
        self._client = mqtt_client.Client(client_id="fire_detector", clean_session=True)
        self._client.on_connect    = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._connected = False
        self._lock = threading.Lock()

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self._connected = True
            print("[MQTT] Connected to broker ✓")
        else:
            print(f"[MQTT] Connection failed, rc={rc}")

    def _on_disconnect(self, client, userdata, rc):
        self._connected = False
        print(f"[MQTT] Disconnected (rc={rc}). Reconnecting...")

    def start(self):
        try:
            self._client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
            self._client.loop_start()
        except Exception as e:
            print(f"[MQTT] Could not connect: {e}")

    def is_connected(self):
        return self._connected

    def publish(self, topic: str, payload: str):
        with self._lock:
            if self._connected:
                self._client.publish(topic, payload)

    def stop(self):
        self._client.loop_stop()
        self._client.disconnect()


mqtt_mgr = MQTTManager()


# ══════════════════════════════════════════════════════════
#  EMAIL ALERT (threaded, non-blocking)
# ══════════════════════════════════════════════════════════
class EmailAlerter:
    def __init__(self):
        # cooldown tracking: (camera_name, class_name) -> last_sent_time
        self._last_sent: dict[tuple, float] = {}
        self._lock = threading.Lock()
        self._queue: queue.Queue = queue.Queue()
        self._worker = threading.Thread(target=self._send_loop, daemon=True)
        self._worker.start()

    def _should_send(self, cam: str, cls: str) -> bool:
        key = (cam, cls)
        now = time.time()
        with self._lock:
            last = self._last_sent.get(key, 0)
            if now - last >= EMAIL_COOLDOWN_SEC:
                self._last_sent[key] = now
                return True
        return False

    def alert(self, cam_name: str, cls_name: str,
              confidence: float, bbox: list, frame: np.ndarray):
        if self._should_send(cam_name, cls_name):
            self._queue.put((cam_name, cls_name, confidence, bbox, frame.copy()))

    def _send_loop(self):
        while True:
            try:
                cam_name, cls_name, conf, bbox, frame = self._queue.get()
                self._send_email(cam_name, cls_name, conf, bbox, frame)
            except Exception as e:
                print(f"[EMAIL] Worker error: {e}")

    def _send_email(self, cam_name: str, cls_name: str,
                    conf: float, bbox: list, frame: np.ndarray):
        subject = EMAIL_SUBJECT_TEMPLATE.format(
            class_name=cls_name.upper(), camera=cam_name
        )
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        x1, y1, x2, y2 = bbox

        # HTML body
        body_html = f"""
        <html><body style="font-family:Arial,sans-serif;background:#0d0d0d;color:#f0f0f0;padding:24px">
          <div style="max-width:600px;margin:auto;background:#1a1a1a;border-radius:12px;
                      border:2px solid #ff4400;padding:24px">
            <h2 style="color:#ff4400;margin-top:0">🔥 FIRE DETECTION ALERT</h2>
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
            <p style="color:#888;font-size:12px;margin-top:16px">
              Automated alert from Fire Detection System
            </p>
          </div>
        </body></html>
        """

        # Encode frame as JPEG for attachment
        _, img_buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        img_bytes  = img_buf.tobytes()

        try:
            msg = MIMEMultipart('related')
            msg['Subject'] = subject
            msg['From']    = EMAIL_FROM
            msg['To']      = ', '.join(TO_EMAILS)

            alt = MIMEMultipart('alternative')
            alt.attach(MIMEText(body_html, 'html'))
            msg.attach(alt)

            img_part = MIMEImage(img_bytes, name=f"alert_{cam_name}_{ts[:10]}.jpg")
            img_part.add_header('Content-Disposition', 'attachment',
                                filename=f"alert_{cam_name}.jpg")
            msg.attach(img_part)

            context = ssl.create_default_context()
            with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
                server.ehlo()
                server.starttls(context=context)
                server.login(EMAIL_FROM, EMAIL_PASSWORD)
                server.sendmail(EMAIL_FROM, TO_EMAILS, msg.as_string())

            print(f"[EMAIL] Alert sent → {', '.join(TO_EMAILS)} | {cam_name} | {cls_name}")

        except Exception as e:
            print(f"[EMAIL] Failed to send: {e}")


email_alerter = EmailAlerter()


# ══════════════════════════════════════════════════════════
#  PER-CAMERA PIPELINE
# ══════════════════════════════════════════════════════════
class CameraPipeline:
    def __init__(self, cam_name: str, rtsp_url: str, save_dir: str | None = None):
        self.cam_name  = cam_name
        self.rtsp_url  = rtsp_url
        self.save_dir  = save_dir

        self.frame_queue = queue.Queue(maxsize=1)
        self.result_lock = threading.Lock()
        self.latest_dets = {"boxes": [], "scores": [], "class_ids": []}
        self.stop_event  = threading.Event()

        self._writer = None
        if save_dir:
            import os
            os.makedirs(save_dir, exist_ok=True)
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            path   = f"{save_dir}/{cam_name}.mp4"
            self._writer = cv2.VideoWriter(path, fourcc, 20.0, (WIDTH, HEIGHT))
            print(f"[{cam_name}] Saving → {path}")

    # ── RTSP reader (ffmpeg subprocess) ───────────────────
    def _rtsp_loop(self):
        frame_size = WIDTH * HEIGHT * 3
        while not self.stop_event.is_set():
            print(f"[{self.cam_name}] Connecting...")
            cmd = [
                "ffmpeg",
                "-rtsp_transport", "tcp",
                "-i", self.rtsp_url,
                "-f", "rawvideo",
                "-pix_fmt", "bgr24",
                "-vf", f"scale={WIDTH}:{HEIGHT}",
                "-an", "-sn",
                "-loglevel", "quiet",
                "pipe:1"
            ]
            try:
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL)
                print(f"[{self.cam_name}] Stream connected ✓")
                while not self.stop_event.is_set():
                    raw = proc.stdout.read(frame_size)
                    if len(raw) != frame_size:
                        print(f"[{self.cam_name}] Stream lost. Reconnecting...")
                        break
                    frame = np.frombuffer(raw, dtype=np.uint8).reshape((HEIGHT, WIDTH, 3))
                    if self.frame_queue.full():
                        try:
                            self.frame_queue.get_nowait()
                        except queue.Empty:
                            pass
                    self.frame_queue.put(frame)
            except Exception as e:
                print(f"[{self.cam_name}] Error: {e}")
            finally:
                try:
                    proc.kill()
                except:
                    pass
            if not self.stop_event.is_set():
                time.sleep(RECONNECT_DELAY)

    # ── Inference loop ─────────────────────────────────────
    def _inference_loop(self):
        net = cv2.dnn.readNet(MODEL_PATH)
        net.setPreferableBackend(cv2.dnn.DNN_BACKEND_TIMVX)
        net.setPreferableTarget(cv2.dnn.DNN_TARGET_NPU)
        print(f"[{self.cam_name}] Model loaded on NPU ✓")

        while not self.stop_event.is_set():
            try:
                frame = self.frame_queue.get(timeout=1.0)
            except queue.Empty:
                continue

            h, w = frame.shape[:2]
            blob = cv2.dnn.blobFromImage(
                frame, 1/255.0, (INPUT_SIZE, INPUT_SIZE),
                swapRB=True, crop=False
            )
            net.setInput(blob)
            outputs = np.squeeze(net.forward()).T

            boxes, scores, class_ids = [], [], []
            for pred in outputs:
                confs      = pred[4:]
                class_id   = int(np.argmax(confs))
                confidence = float(confs[class_id])
                if confidence < CONF_THRESH:
                    continue
                cx, cy, bw, bh = pred[:4]
                cx = cx / INPUT_SIZE * w
                cy = cy / INPUT_SIZE * h
                bw = bw / INPUT_SIZE * w
                bh = bh / INPUT_SIZE * h
                x1 = int(cx - bw / 2)
                y1 = int(cy - bh / 2)
                x2 = int(cx + bw / 2)
                y2 = int(cy + bh / 2)
                boxes.append([x1, y1, x2 - x1, y2 - y1])   # [x,y,w,h] for NMS
                scores.append(confidence)
                class_ids.append(class_id)

            keep = cv2.dnn.NMSBoxes(boxes, scores, CONF_THRESH, NMS_THRESH)
            keep = list(keep) if len(keep) > 0 else []

            # ── Publish & alert for each detection ────────
            ts = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
            for i in keep:
                x, y, bw, bh = boxes[i]
                x1, y1, x2, y2 = x, y, x + bw, y + bh
                cls_name = CLASSES[class_ids[i]] if class_ids[i] < len(CLASSES) \
                           else str(class_ids[i])
                conf     = scores[i]

                # MQTT publish
                data = {
                    "camera":     self.cam_name,
                    "class":      cls_name,
                    "confidence": round(float(conf), 3),
                    "bbox":       [x1, y1, x2, y2],
                    "timestamp":  ts
                }
                mqtt_mgr.publish(MQTT_FIRE_TOPIC, json.dumps(data))
                print(f"[{ts}] [{self.cam_name}] Published to MQTT: {json.dumps(data)}")

                # Email alert (non-blocking, with cooldown)
                email_alerter.alert(self.cam_name, cls_name, conf,
                                    [x1, y1, x2, y2], frame)

            with self.result_lock:
                self.latest_dets["boxes"]     = [boxes[i] for i in keep]
                self.latest_dets["scores"]    = [scores[i] for i in keep]
                self.latest_dets["class_ids"] = [class_ids[i] for i in keep]

    # ── Draw overlays ──────────────────────────────────────
    def draw(self, frame: np.ndarray, dets: dict, fps: float) -> np.ndarray:
        for i in range(len(dets["boxes"])):
            x, y, w, h = dets["boxes"][i]
            cls_name  = CLASSES[dets["class_ids"][i]] \
                        if dets["class_ids"][i] < len(CLASSES) \
                        else str(dets["class_ids"][i])
            score     = dets["scores"][i]
            color     = COLORS.get(cls_name, DEFAULT_COLOR)
            label     = f"{cls_name.upper()}: {score:.2f}"

            # Bounding box
            cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)

            # Label background
            (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            cv2.rectangle(frame, (x, y - lh - 12), (x + lw + 6, y), color, -1)
            cv2.putText(frame, label, (x + 3, y - 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

            # Pulsing warning overlay on fire detections
            if cls_name in ("fire", "flame"):
                overlay = frame.copy()
                cv2.rectangle(overlay, (x, y), (x+w, y+h), (0, 0, 255), -1)
                cv2.addWeighted(overlay, 0.15, frame, 0.85, 0, frame)

        # HUD
        cv2.putText(frame, f"FPS: {fps:.1f}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        cv2.putText(frame, f"Detections: {len(dets['boxes'])}", (10, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        cv2.putText(frame, self.cam_name, (10, 90),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 255), 2)

        # Fire warning banner
        if any(CLASSES[cid] in ("fire", "flame")
               for cid in dets["class_ids"] if cid < len(CLASSES)):
            cv2.rectangle(frame, (0, HEIGHT - 40), (WIDTH, HEIGHT), (0, 0, 200), -1)
            cv2.putText(frame, "⚠  FIRE DETECTED  ⚠", (WIDTH//2 - 140, HEIGHT - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)

        return frame

    # ── Start all threads ──────────────────────────────────
    def start(self):
        threading.Thread(target=self._rtsp_loop,      daemon=True).start()
        threading.Thread(target=self._inference_loop, daemon=True).start()

    def stop(self):
        self.stop_event.set()
        if self._writer:
            self._writer.release()

    def get_latest(self):
        with self.result_lock:
            return dict(self.latest_dets)

    def write_frame(self, frame: np.ndarray):
        if self._writer:
            self._writer.write(frame)


# ══════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════
def main():
    # Start MQTT
    mqtt_mgr.start()
    time.sleep(1)   # let MQTT connect

    # Create pipelines
    pipelines: list[CameraPipeline] = []
    for name, url in CAMERAS:
        p = CameraPipeline(name, url, save_dir=args.save)
        p.start()
        pipelines.append(p)

    mode = ("display" if args.display else "") + \
           (" + save" if args.save else "") or "headless"
    print(f"\nMode: {mode} | Cameras: {len(pipelines)}")
    print("Press Q (in any window) to quit\n")

    fps_trackers = {p.cam_name: {"fps": 0, "prev": time.time()} for p in pipelines}
    frame_counts = {p.cam_name: 0 for p in pipelines}

    # Per-camera frame buffers (latest pulled from queue)
    cur_frames: dict[str, np.ndarray | None] = {p.cam_name: None for p in pipelines}

    try:
        while True:
            for p in pipelines:
                # Pull latest frame (non-blocking peek)
                try:
                    frame = p.frame_queue.get_nowait()
                    cur_frames[p.cam_name] = frame
                except queue.Empty:
                    frame = cur_frames[p.cam_name]

                if frame is None:
                    if args.display:
                        blank = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
                        cv2.putText(blank, f"[{p.cam_name}] Waiting...",
                                    (80, HEIGHT//2), cv2.FONT_HERSHEY_SIMPLEX,
                                    0.9, (80, 80, 80), 2)
                        cv2.imshow(p.cam_name, blank)
                    continue

                # FPS
                t = fps_trackers[p.cam_name]
                now  = time.time()
                t["fps"] = 0.9 * t["fps"] + 0.1 / max(now - t["prev"], 1e-9)
                t["prev"] = now
                frame_counts[p.cam_name] += 1

                dets = p.get_latest()

                if args.display or args.save:
                    vis = p.draw(frame.copy(), dets, t["fps"])
                else:
                    vis = frame

                if args.display:
                    cv2.imshow(p.cam_name, vis)

                p.write_frame(vis)

                # Headless console output
                if not args.display and not args.save and dets["boxes"]:
                    labels = [CLASSES[dets["class_ids"][i]]
                              if dets["class_ids"][i] < len(CLASSES)
                              else str(dets["class_ids"][i])
                              for i in range(len(dets["boxes"]))]
                    fc = frame_counts[p.cam_name]
                    print(f"[{fc}] [{p.cam_name}] FPS:{t['fps']:.1f} | "
                          f"{len(dets['boxes'])} detected: {', '.join(labels)}")

            if args.display:
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    print("Quitting...")
                    break

    except KeyboardInterrupt:
        print("\nStopped by user.")

    finally:
        for p in pipelines:
            p.stop()
        mqtt_mgr.stop()
        if args.display:
            cv2.destroyAllWindows()
        if args.save:
            print(f"Videos saved to: {args.save}/")


if __name__ == "__main__":
    main()
