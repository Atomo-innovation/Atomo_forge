#!/usr/bin/env python3
"""
shared_stream.py — Single-source RTSP Frame Broker

Opens each RTSP camera ONCE and distributes frames to:
  1. fire.py        (via multiprocessing shared queue)
  2. person1.py     (via multiprocessing shared queue)
  3. MediaMTX       (via FFmpeg RTSP/RTMP push — one outbound stream per camera)

This eliminates the 3x-per-camera RTSP connection problem.
"""

import os
import cv2
import time
import queue
import threading
import subprocess
import numpy as np
from typing import Dict, List, Optional

os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
    "rtsp_transport;tcp"
    "|fflags;nobuffer+discardcorrupt"
    "|flags;low_delay"
    "|analyzeduration;500000"
    "|probesize;500000"
    "|stimeout;10000000"
    "|tcp_nodelay;1"
    "|reconnect;1"
    "|reconnect_streamed;1"
    "|reconnect_delay_max;5"
)

# ─── CONFIG ────────────────────────────────────────────────
CAMERAS = [
    {"id": "cam1", "rtsp": "rtsp://admin:Admin@123@10.30.41.161:554/profile2/media.smp"},
    {"id": "cam2", "rtsp": "rtsp://admin:Admin@123@10.30.41.142:554/profile2/media.smp"},
]

# MediaMTX is running locally; we push to its RTSP publish port (default 8554)
# Then fire.py / person1.py read from THIS broker's queues in-process (not RTSP)
MEDIAMTX_HOST  = "localhost"
MEDIAMTX_PORT  = 8554         # MediaMTX RTSP publish port

FRAME_WIDTH    = 640
FRAME_HEIGHT   = 480
TARGET_FPS     = 15           # Reduce from camera native FPS to save CPU/bandwidth

# Max frames buffered per consumer before dropping (prevents memory bloat)
QUEUE_MAXSIZE  = 4
# ──────────────────────────────────────────────────────────


class FrameBroker:
    """
    Opens one RTSP connection per camera.
    Fans out decoded frames to N consumer queues + 1 FFmpeg publisher.
    """

    def __init__(self, cam_id: str, rtsp_url: str):
        self.cam_id   = cam_id
        self.rtsp_url = rtsp_url

        # One queue per subscriber — add more here if you add more detectors
        self.fire_queue:   queue.Queue = queue.Queue(maxsize=QUEUE_MAXSIZE)
        self.person_queue: queue.Queue = queue.Queue(maxsize=QUEUE_MAXSIZE)

        # Overlay frames (detectors write back annotated frames)
        self.overlay_lock  = threading.Lock()
        self.overlay_frame: Optional[np.ndarray] = None

        self._stop   = threading.Event()
        self._ffmpeg: Optional[subprocess.Popen] = None

    # ── helpers ──────────────────────────────────────────
    def _open_cap(self) -> cv2.VideoCapture:
        cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  FRAME_WIDTH)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
        return cap

    def _push_to_queue(self, q: queue.Queue, frame: np.ndarray):
        """Non-blocking put — drops oldest frame when full."""
        try:
            q.put_nowait(frame)
        except queue.Full:
            try:
                q.get_nowait()
                q.put_nowait(frame)
            except Exception:
                pass

    # ── FFmpeg publisher thread ───────────────────────────
    def _start_ffmpeg(self) -> subprocess.Popen:
        """
        Spawn FFmpeg that reads raw BGR frames from stdin and publishes
        to MediaMTX as RTSP. The stream will be available at:
            rtsp://<MEDIAMTX_HOST>:<MEDIAMTX_PORT>/<cam_id>
        Your Node dashboard subscribes to THIS URL instead of the camera.
        """
        publish_url = f"rtsp://{MEDIAMTX_HOST}:{MEDIAMTX_PORT}/{self.cam_id}"
        cmd = [
            "ffmpeg",
            "-y",
            "-f",  "rawvideo",
            "-vcodec", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s",  f"{FRAME_WIDTH}x{FRAME_HEIGHT}",
            "-r",  str(TARGET_FPS),
            "-i",  "pipe:0",                # read from stdin
            "-vcodec", "libx264",
            "-preset",  "ultrafast",        # lowest encoder latency
            "-tune",    "zerolatency",
            "-pix_fmt", "yuv420p",
            "-g",       str(TARGET_FPS * 2),# keyframe every 2 s
            "-f",       "rtsp",
            "-rtsp_transport", "tcp",
            publish_url,
        ]
        print(f"[Broker:{self.cam_id}] FFmpeg publishing to {publish_url}")
        return subprocess.Popen(
            cmd, stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

    # ── Main capture + fan-out thread ────────────────────
    def _run(self):
        cap = self._open_cap()
        self._ffmpeg = self._start_ffmpeg()

        frame_interval = 1.0 / TARGET_FPS
        last_frame_time = 0.0
        retry_delay = 2

        print(f"[Broker:{self.cam_id}] Started — source: {self.rtsp_url}")

        while not self._stop.is_set():
            ret, raw_frame = cap.read()
            if not ret or raw_frame is None:
                print(f"[Broker:{self.cam_id}] Read failed, reconnecting in {retry_delay}s...")
                cap.release()
                time.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 30)
                cap = self._open_cap()
                continue
            retry_delay = 2

            now = time.time()
            if now - last_frame_time < frame_interval:
                continue                    # throttle to TARGET_FPS
            last_frame_time = now

            frame = cv2.resize(raw_frame, (FRAME_WIDTH, FRAME_HEIGHT))

            # 1. Fan out raw frame to detectors (they do their own inference)
            self._push_to_queue(self.fire_queue,   frame.copy())
            self._push_to_queue(self.person_queue, frame.copy())

            # 2. Push annotated (or raw if no overlay yet) frame to MediaMTX
            with self.overlay_lock:
                send_frame = self.overlay_frame if self.overlay_frame is not None else frame

            try:
                self._ffmpeg.stdin.write(send_frame.tobytes())
            except BrokenPipeError:
                print(f"[Broker:{self.cam_id}] FFmpeg pipe broken, restarting...")
                self._ffmpeg = self._start_ffmpeg()

        cap.release()
        if self._ffmpeg:
            self._ffmpeg.stdin.close()
            self._ffmpeg.wait()
        print(f"[Broker:{self.cam_id}] Stopped.")

    def update_overlay(self, frame: np.ndarray):
        """Detectors call this to push their annotated frame for streaming."""
        with self.overlay_lock:
            self.overlay_frame = frame

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()


# ─── GLOBAL BROKER REGISTRY ───────────────────────────────
# Import this dict from fire.py / person1.py to get queues.
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


# ─── STANDALONE TEST ──────────────────────────────────────
if __name__ == "__main__":
    import signal

    print("Starting frame broker for all cameras...")
    start_all()

    def _sig(s, f):
        print("\nStopping...")
        stop_all()
        raise SystemExit(0)

    signal.signal(signal.SIGINT, _sig)

    # Just show FPS stats
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
                print(f"[{cam_id}] {cnt / elapsed:.1f} fps delivered to consumers")
            counts = {k: 0 for k in counts}
            t0 = time.time()
