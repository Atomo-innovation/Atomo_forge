"""
rtsp_inference_stream.py
────────────────────────
Headless YOLO inference on an RTSP camera.
Annotated frames are streamed to MediaMTX via FFmpeg over RTSP.
No display / no cv.imshow() needed.

Usage:
    python3 rtsp_inference_stream.py \
        --library  /path/to/libnn.so \
        --model    /path/to/model.nb  \
        --rtsp     rtsp://admin:pass@192.168.1.10:554/stream1 \
        --out-rtsp rtsp://localhost:8554/detection \
        --width    2304 --height 1296

Then watch in any player:
    VLC:     rtsp://YOUR_BOARD_IP:8554/detection
    Browser: http://YOUR_BOARD_IP:8888/detection  (HLS)
             http://YOUR_BOARD_IP:8889/detection  (WebRTC)
    mpv:     mpv rtsp://YOUR_BOARD_IP:8554/detection
"""

import numpy as np
import os
import argparse
import sys
import threading
import time
import subprocess
import signal
from collections import deque
import cv2 as cv
from asnn.api import asnn
from asnn.types import *

# ─── Grid / model constants ───────────────────────────────────────────────────
GRID0    = 20
GRID1    = 40
GRID2    = 80
LISTSIZE = 65
SPAN     = 1
NUM_CLS  = 2
OBJ_THRESH = 0.35
NMS_THRESH = 0.3
mean = [0, 0, 0]
var  = [255]

os.environ["QT_QPA_PLATFORM"] = "offscreen"          # no display needed
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

constant_martix = np.array([[0,  1,  2,  3,
                              4,  5,  6,  7,
                              8,  9,  10, 11,
                              12, 13, 14, 15]]).T

CLASSES = (
    "person",)


# ─── Letterbox ────────────────────────────────────────────────────────────────

def letterbox(frame, target=640):
    h, w   = frame.shape[:2]
    scale  = target / max(h, w)
    nh, nw = int(h * scale), int(w * scale)
    resized = cv.resize(frame, (nw, nh))
    canvas  = np.full((target, target, 3), 114, dtype=np.uint8)
    y0 = (target - nh) // 2
    x0 = (target - nw) // 2
    canvas[y0:y0+nh, x0:x0+nw] = resized
    return canvas, scale, x0, y0


def unletterbox_boxes(boxes, scale, x0, y0, orig_w, orig_h, target=640):
    boxes = boxes.copy()
    boxes[:, 0] *= target;  boxes[:, 2] *= target
    boxes[:, 1] *= target;  boxes[:, 3] *= target
    boxes[:, 0] -= x0;      boxes[:, 2] -= x0
    boxes[:, 1] -= y0;      boxes[:, 3] -= y0
    boxes /= scale
    boxes[:, 0] = np.clip(boxes[:, 0], 0, orig_w)
    boxes[:, 1] = np.clip(boxes[:, 1], 0, orig_h)
    boxes[:, 2] = np.clip(boxes[:, 2], 0, orig_w)
    boxes[:, 3] = np.clip(boxes[:, 3], 0, orig_h)
    return boxes


# ─── Model helpers ────────────────────────────────────────────────────────────

def sigmoid(x):
    return 1 / (1 + np.exp(-x))

def softmax(x, axis=0):
    x = np.exp(x)
    return x / x.sum(axis=axis, keepdims=True)

def process(input):
    grid_h, grid_w = map(int, input.shape[0:2])
    box_class_probs = sigmoid(input[..., :NUM_CLS])
    box_0 = softmax(input[..., NUM_CLS:      NUM_CLS+16], -1)
    box_1 = softmax(input[..., NUM_CLS+16:   NUM_CLS+32], -1)
    box_2 = softmax(input[..., NUM_CLS+32:   NUM_CLS+48], -1)
    box_3 = softmax(input[..., NUM_CLS+48:   NUM_CLS+64], -1)
    result = np.zeros((grid_h, grid_w, 1, 4))
    result[..., 0] = np.dot(box_0, constant_martix)[..., 0]
    result[..., 1] = np.dot(box_1, constant_martix)[..., 0]
    result[..., 2] = np.dot(box_2, constant_martix)[..., 0]
    result[..., 3] = np.dot(box_3, constant_martix)[..., 0]
    # Fixed tile axes (bug 5 from previous review)
    col = np.tile(np.arange(0, grid_w), grid_h).reshape(-1, grid_w)
    row = np.tile(np.arange(0, grid_h).reshape(-1, 1), grid_w)
    col = col.reshape(grid_h, grid_w, 1, 1)
    row = row.reshape(grid_h, grid_w, 1, 1)
    grid = np.concatenate((col, row), axis=-1)
    result[..., 0:2] = (0.5 - result[..., 0:2] + grid) / (grid_w, grid_h)
    result[..., 2:4] = (0.5 + result[..., 2:4] + grid) / (grid_w, grid_h)
    return result, box_class_probs

def filter_boxes(boxes, box_class_probs):
    box_classes      = np.argmax(box_class_probs, axis=-1)
    box_class_scores = np.max(box_class_probs, axis=-1)
    pos = np.where(box_class_scores >= OBJ_THRESH)
    return boxes[pos], box_classes[pos], box_class_scores[pos]

def nms_boxes(boxes, scores):
    x1, y1, x2, y2 = boxes[:,0], boxes[:,1], boxes[:,2], boxes[:,3]
    areas = (x2-x1)*(y2-y1)
    order = scores.argsort()[::-1]
    keep  = []
    while order.size > 0:
        i = order[0]; keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]]); yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]]); yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0.0, xx2-xx1+1e-5) * np.maximum(0.0, yy2-yy1+1e-5)
        ovr   = inter / (areas[i] + areas[order[1:]] - inter)
        order = order[np.where(ovr <= NMS_THRESH)[0] + 1]
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
        b, cc, s = boxes[inds], classes[inds], scores[inds]
        keep = nms_boxes(b, s)
        nboxes.append(b[keep]); nclasses.append(cc[keep]); nscores.append(s[keep])
    if not nclasses:
        return None, None, None
    return np.concatenate(nboxes), np.concatenate(nscores), np.concatenate(nclasses)

def draw_px(image, boxes_px, scores, classes):
    for box, score, cl in zip(boxes_px, scores, classes):
        x1, y1, x2, y2 = box
        left   = max(0, round(float(x1)))
        top    = max(0, round(float(y1)))
        right  = min(image.shape[1], round(float(x2)))
        bottom = min(image.shape[0], round(float(y2)))
        if right <= left or bottom <= top:
            continue
        cv.rectangle(image, (left, top), (right, bottom), (255, 0, 0), 2)
        cv.putText(image, '{} {:.2f}'.format(CLASSES[cl].strip(), score),
                   (left, max(top - 6, 10)),
                   cv.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)


# ─── RTSPReader (threaded, deduplicating) ─────────────────────────────────────

class RTSPReader:
    def __init__(self, url):
        self.url     = url
        self.frame   = None
        self.seq     = 0
        self.lock    = threading.Lock()
        self.running = False
        self._open()

    def _open(self):
        self.cap = cv.VideoCapture(self.url, cv.CAP_FFMPEG)
        self.cap.set(cv.CAP_PROP_BUFFERSIZE, 1)

    def start(self):
        self.running = True
        threading.Thread(target=self._reader, daemon=True).start()
        return self

    def _reader(self):
        fails = 0
        while self.running:
            ret, frame = self.cap.read()
            if not ret:
                fails += 1
                print(f'[RTSPReader] Reconnecting... ({fails})')
                self.cap.release()
                time.sleep(min(fails, 5))
                self._open()
                continue
            fails = 0
            with self.lock:
                self.frame = frame
                self.seq  += 1

    def read(self):
        with self.lock:
            if self.frame is None:
                return False, None, -1
            return True, self.frame.copy(), self.seq

    def stop(self):
        self.running = False
        self.cap.release()


# ─── FFmpeg RTSP pusher ───────────────────────────────────────────────────────

import queue as _queue

class FFmpegPusher:
    """
    Pushes annotated BGR frames to MediaMTX via FFmpeg using a
    dedicated background thread and a size-capped queue.

    KEY DESIGN DECISIONS vs the old blocking version:
    ─────────────────────────────────────────────────
    1. NON-BLOCKING enqueue()
       The inference loop calls enqueue() which just drops the frame into a
       queue and returns immediately. The actual stdin.write() happens in a
       separate thread. Inference never blocks waiting for FFmpeg.

    2. QUEUE MAXSIZE = 2  (drop-oldest policy)
       If FFmpeg falls behind (encode slow, network congested), old frames
       are dropped from the queue and only the latest 2 are kept. This means
       the viewer always sees NOW, never the past. Without this cap, the queue
       grows, latency builds up, and you eventually see frames from minutes ago.

    3. BITRATE: 4000k target / 6000k max for 1920×1080
       1500k was causing blur because H.264 was forced to discard too much
       detail to hit the low target. 4000k gives the encoder enough budget to
       reproduce fine detail cleanly at 1920×1080 @ 15fps.
       Rule of thumb:  width × height × fps × 0.07 / 1000  ≈ kbps needed
       1920 × 1080 × 15 × 0.07 / 1000 ≈ 2177k minimum → 4000k gives headroom.

    4. CRF fallback (quality-based, not bitrate-based)
       If you're on a LAN and don't care about a fixed bitrate, CRF mode gives
       better quality per bit than CBR. Toggle with use_crf=True.
    """

    def __init__(self, rtsp_url: str, width: int, height: int,
                 fps: int = 15, bitrate_k: int = 4000, use_crf: bool = False):
        self.rtsp_url  = rtsp_url
        self.width     = width
        self.height    = height
        self.fps       = fps
        self.bitrate_k = bitrate_k
        self.use_crf   = use_crf
        self.proc      = None

        # Size-capped queue: maxsize=2 → drop oldest, always send freshest frame
        self._q        = _queue.Queue(maxsize=2)
        self._running  = True
        # Lock that must be held whenever self.proc is read or replaced.
        # Prevents "write to closed file" ValueError when FFmpeg is restarted
        # while the writer thread is mid-write.
        self._proc_lock = threading.Lock()

        self._start_ffmpeg()

        # Single dedicated thread owns all stdin.write() calls
        self._writer_thread = threading.Thread(
            target=self._writer_loop, daemon=True)
        self._writer_thread.start()

    # ── FFmpeg process ────────────────────────────────────────────────────────

    def _build_cmd(self):
        encode_args = []
        if self.use_crf:
            # CRF mode: constant quality, variable bitrate — best for LAN
            # crf=23 is default quality; lower = better quality, higher CPU
            encode_args = ['-crf', '23', '-maxrate', f'{self.bitrate_k * 2}k',
                           '-bufsize', f'{self.bitrate_k * 2}k']
        else:
            # CBR mode: fixed bitrate — predictable for bandwidth-limited links
            encode_args = [
                '-b:v',     f'{self.bitrate_k}k',
                '-maxrate', f'{int(self.bitrate_k * 1.5)}k',
                '-bufsize', f'{self.bitrate_k * 2}k',
            ]

        return [
            'ffmpeg', '-y',

            # ── Input: raw BGR frames from Python via stdin ────────────────
            '-f',       'rawvideo',
            '-vcodec',  'rawvideo',
            '-pix_fmt', 'bgr24',
            '-s',       f'{self.width}x{self.height}',
            '-r',       str(self.fps),
            '-i',       'pipe:0',

            # ── Encode ────────────────────────────────────────────────────
            '-vcodec',  'libx264',
            '-pix_fmt', 'yuv420p',          # broadest player compatibility
            '-preset',  'ultrafast',        # min encode CPU — critical on ARM
            '-tune',    'zerolatency',      # no lookahead, no B-frames, no delay

            *encode_args,

            # Keyframe every 1 second — faster seeking and lower HLS latency
            '-g',       str(self.fps),
            '-keyint_min', str(self.fps),
            '-sc_threshold', '0',           # disable scene-cut keyframes

            # ── Output: RTSP push to MediaMTX ─────────────────────────────
            '-f',              'rtsp',
            '-rtsp_transport', 'tcp',
            self.rtsp_url,
        ]

    def _start_ffmpeg(self):
        cmd = self._build_cmd()
        print(f'[FFmpegPusher] cmd: {" ".join(cmd)}')
        self.proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        threading.Thread(target=self._drain_stderr, daemon=True).start()

    def _drain_stderr(self):
        """Read FFmpeg stderr in background so it never blocks the pipe."""
        for raw in self.proc.stderr:
            line = raw.decode(errors='replace').strip()
            # Only print lines that look useful — suppress the banner spam
            if line and not line.startswith('  ') and 'Copyright' not in line:
                print(f'[FFmpeg] {line}')

    # ── Writer thread ─────────────────────────────────────────────────────────

    def _writer_loop(self):
        """
        Runs in its own thread. Pulls frames from the queue and writes them
        to FFmpeg stdin. If FFmpeg dies, restarts it transparently.

        FIX: _start_ffmpeg() is called while holding self._proc_lock so the
        writer never reads a half-replaced self.proc. The ValueError
        "write to closed file" was caused by _start_ffmpeg() closing the old
        stdin while the writer was about to use it — now guarded by a lock.
        On a persistent 401 (auth failure), we back off 5 s between retries
        instead of spinning immediately.
        """
        consecutive_fails = 0
        while self._running:
            try:
                frame = self._q.get(timeout=1.0)
            except _queue.Empty:
                continue

            with self._proc_lock:
                # Restart FFmpeg if it exited (401, network drop, etc.)
                if self.proc is None or self.proc.poll() is not None:
                    delay = min(5 * consecutive_fails, 30)  # backoff up to 30s
                    if delay:
                        print(f'[FFmpegPusher] Waiting {delay}s before restart ...')
                        time.sleep(delay)
                    print(f'[FFmpegPusher] Restarting FFmpeg → {self.rtsp_url}')
                    self._start_ffmpeg()

                try:
                    self.proc.stdin.write(frame.tobytes())
                    self.proc.stdin.flush()
                    consecutive_fails = 0          # success — reset counter
                except (BrokenPipeError, OSError, ValueError):
                    # ValueError = "write to closed file" — proc just died
                    consecutive_fails += 1
                    print(f'[FFmpegPusher] Write failed (fail #{consecutive_fails}) — will restart')
                    try:
                        self.proc.stdin.close()
                    except Exception:
                        pass

    # ── Public API ────────────────────────────────────────────────────────────

    def enqueue(self, frame: np.ndarray):
        """
        Non-blocking frame submission.
        If the queue is full (FFmpeg fell behind), drop the oldest frame
        and insert this one — we always want the freshest frame in the queue.
        """
        try:
            self._q.put_nowait(frame)
        except _queue.Full:
            try:
                self._q.get_nowait()       # discard oldest
            except _queue.Empty:
                pass
            try:
                self._q.put_nowait(frame)  # insert newest
            except _queue.Full:
                pass                       # extremely rare race — just skip

    def stop(self):
        self._running = False
        self._writer_thread.join(timeout=3)
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.stdin.close()
            except Exception:
                pass
            self.proc.wait(timeout=5)


# ─── Comparison web server ────────────────────────────────────────────────────

COMPARE_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YOLO Detection — Live Comparison</title>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0f0f0f;
    color: #e0e0e0;
    font-family: 'Segoe UI', system-ui, sans-serif;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 20px;
    background: #1a1a1a;
    border-bottom: 1px solid #2a2a2a;
    flex-shrink: 0;
  }
  header h1 { font-size: 16px; font-weight: 500; letter-spacing: .04em; }
  .pill {
    font-size: 11px; padding: 3px 10px; border-radius: 20px;
    background: #1f3a1f; color: #6fcf6f;
    display: flex; align-items: center; gap: 6px;
  }
  .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #6fcf6f;
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  .streams {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 10px;
    flex: 1;
    min-height: 0;
  }
  .stream-box {
    background: #1a1a1a;
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    border: 1px solid #2a2a2a;
  }
  .stream-label {
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: .05em;
    text-transform: uppercase;
    border-bottom: 1px solid #2a2a2a;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .label-raw  { color: #7eb8f7; }
  .label-det  { color: #f7a07e; }
  .badge-raw  { font-size:10px; background:#162030; color:#7eb8f7; padding:2px 8px; border-radius:20px; }
  .badge-det  { font-size:10px; background:#302016; color:#f7a07e; padding:2px 8px; border-radius:20px; }
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
    flex: 1;
    min-height: 0;
  }
  .status {
    font-size: 11px;
    padding: 5px 14px;
    color: #666;
    border-top: 1px solid #222;
    flex-shrink: 0;
    min-height: 26px;
  }
  footer {
    padding: 6px 20px;
    font-size: 11px;
    color: #444;
    text-align: center;
    border-top: 1px solid #1a1a1a;
    flex-shrink: 0;
  }
</style>
</head>
<body>

<header>
  <h1>YOLO Detection — Live Comparison</h1>
  <div class="pill"><div class="dot"></div>Live</div>
</header>

<div class="streams">
  <div class="stream-box">
    <div class="stream-label label-raw">
      Raw Input
      <span class="badge-raw">No inference</span>
    </div>
    <video id="v-raw" autoplay muted playsinline></video>
    <div class="status" id="s-raw">Connecting...</div>
  </div>

  <div class="stream-box">
    <div class="stream-label label-det">
      Detection Output
      <span class="badge-det">YOLO annotated</span>
    </div>
    <video id="v-det" autoplay muted playsinline></video>
    <div class="status" id="s-det">Connecting...</div>
  </div>
</div>

<footer>
  Raw: {raw_hls} &nbsp;|&nbsp; Detection: {det_hls} &nbsp;|&nbsp;
  Board: {board_ip}
</footer>

<script>
function attachHls(videoId, statusId, hlsUrl) {
  var video  = document.getElementById(videoId);
  var status = document.getElementById(statusId);

  if (Hls.isSupported()) {
    var hls = new Hls({
      lowLatencyMode: true,
      liveSyncDurationCount: 1,     // stay within 1 segment of live edge
      liveMaxLatencyDurationCount: 3,
      maxBufferLength: 4,
      maxMaxBufferLength: 8,
    });
    hls.loadSource(hlsUrl);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, function() {
      status.textContent = 'Connected — playing';
      video.play();
    });
    hls.on(Hls.Events.ERROR, function(event, data) {
      if (data.fatal) {
        status.textContent = 'Error: ' + data.type + ' — retrying...';
        setTimeout(function(){ hls.loadSource(hlsUrl); }, 3000);
      }
    });
    hls.on(Hls.Events.FRAG_LOADED, function(e, d) {
      var lat = ((Date.now()/1000) - (d.frag.programDateTime/1000)).toFixed(1);
      status.textContent = 'Latency: ~' + lat + 's';
    });

  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS on Safari / iOS
    video.src = hlsUrl;
    video.addEventListener('loadedmetadata', function() {
      status.textContent = 'Connected (native HLS)';
      video.play();
    });
  } else {
    status.textContent = 'HLS not supported in this browser.';
  }
}

attachHls('v-raw', 's-raw', '{raw_hls}');
attachHls('v-det', 's-det', '{det_hls}');
</script>
</body>
</html>
"""

def start_web_server(board_ip: str, hls_port: int,
                     raw_path: str, det_path: str,
                     web_port: int = 8080):
    """
    Serve a single-page comparison UI using only the stdlib http.server.
    No Flask dependency needed — works out of the box.

    URL: http://BOARD_IP:8080/
    """
    raw_hls = f'http://{board_ip}:{hls_port}/{raw_path}'
    det_hls = f'http://{board_ip}:{hls_port}/{det_path}'

    # Use simple replace instead of .format() — CSS curly braces like
    # { box-sizing: border-box } cause KeyError with .format().
    html = (COMPARE_HTML
            .replace('{raw_hls}',  raw_hls)
            .replace('{det_hls}',  det_hls)
            .replace('{board_ip}', board_ip)
            ).encode()

    from http.server import BaseHTTPRequestHandler, HTTPServer

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(html)))
            self.end_headers()
            self.wfile.write(html)

        def log_message(self, fmt, *args):
            pass  # suppress per-request access log noise

    server = HTTPServer(('0.0.0.0', web_port), Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    print(f'[WebServer] Comparison page: http://{board_ip}:{web_port}/')
    return server


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='Headless YOLO inference — dual stream (raw + detection) → MediaMTX'
    )
    parser.add_argument('--library',    required=True, help='Path to ASNN .so library')
    parser.add_argument('--model',      required=True, help='Path to .nb model file')
    parser.add_argument('--rtsp',       required=True, help='Input RTSP camera URL')

    # MediaMTX base URL — paths /raw and /detection are appended automatically
    parser.add_argument('--mediamtx',   default='rtsp://localhost:8554',
                        help='MediaMTX RTSP base URL (default: rtsp://localhost:8554)')
    parser.add_argument('--hls-port',   type=int, default=8888,
                        help='MediaMTX HLS port (default: 8888)')
    parser.add_argument('--web-port',   type=int, default=8080,
                        help='Comparison web page port (default: 8080)')

    parser.add_argument('--width',      type=int, default=1920, help='Camera frame width')
    parser.add_argument('--height',     type=int, default=1080, help='Camera frame height')
    parser.add_argument('--out-fps',    type=int, default=15,
                        help='Output stream FPS (default 15)')
    parser.add_argument('--bitrate',    type=int, default=4000,
                        help='Bitrate kbps per stream (default 4000)')
    parser.add_argument('--crf',        action='store_true',
                        help='Use CRF quality mode instead of fixed bitrate')
    parser.add_argument('--level',      default='0')
    args = parser.parse_args()

    for path, label in [(args.library, 'library'), (args.model, 'model')]:
        if not os.path.exists(path):
            sys.exit(f"[ERROR] {label} not found: '{path}'")

    # Derive stream URLs
    raw_rtsp = f'{args.mediamtx}/raw'
    det_rtsp = f'{args.mediamtx}/detection'

    # Board IP for the web page URLs
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        board_ip = s.getsockname()[0]
        s.close()
    except Exception:
        board_ip = '127.0.0.1'

    # ── Load model ────────────────────────────────────────────────────────────
    level = int(args.level) if args.level in ('1', '2') else 0
    yolov3 = asnn('Electron')
    print(' |---+ asnn Version: {} +---| '.format(yolov3.get_nn_version()))
    print('Initialising NPU ...')
    yolov3.nn_init(library=args.library, model=args.model, level=level)
    print('NPU ready.')

    # ── Connect camera ────────────────────────────────────────────────────────
    reader = RTSPReader(args.rtsp).start()
    print(f'Connecting to {args.rtsp} ...')
    for _ in range(100):
        ok, _, _ = reader.read()
        if ok: break
        time.sleep(0.1)
    else:
        sys.exit('[ERROR] No frame received from camera.')
    print('Camera connected.')

    # ── Start TWO FFmpeg pushers ──────────────────────────────────────────────
    # pusher_raw  → /raw      : original camera frames, no annotations
    # pusher_det  → /detection: frames after inference + bounding boxes drawn
    pusher_cfg = dict(
        width=args.width, height=args.height,
        fps=args.out_fps, bitrate_k=args.bitrate, use_crf=args.crf
    )
    pusher_raw = FFmpegPusher(rtsp_url=raw_rtsp, **pusher_cfg)
    pusher_det = FFmpegPusher(rtsp_url=det_rtsp, **pusher_cfg)

    # ── Start comparison web server ───────────────────────────────────────────
    start_web_server(
        board_ip=board_ip,
        hls_port=args.hls_port,
        raw_path='raw',
        det_path='detection',
        web_port=args.web_port,
    )

    print(f'\n{"═"*54}')
    print(f'  Raw stream:       http://{board_ip}:{args.hls_port}/raw')
    print(f'  Detection stream: http://{board_ip}:{args.hls_port}/detection')
    print(f'  Comparison page:  http://{board_ip}:{args.web_port}/')
    print(f'  VLC raw:          {raw_rtsp}')
    print(f'  VLC detection:    {det_rtsp}')
    print(f'{"═"*54}\n')
    print('Press Ctrl+C to stop.\n')

    # ── Graceful shutdown ─────────────────────────────────────────────────────
    stop_event = threading.Event()

    def _shutdown(sig, _frame):
        print('\n[INFO] Shutting down ...')
        stop_event.set()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT,  _shutdown)

    # ── Inference loop ────────────────────────────────────────────────────────
    fps_times = deque(maxlen=60)
    last_seq  = -1

    while not stop_event.is_set():

        ret, orig_img, seq = reader.read()
        if not ret or orig_img is None:
            time.sleep(0.01)
            continue

        if seq == last_seq:
            time.sleep(0.005)
            continue
        last_seq = seq

        orig_h, orig_w = orig_img.shape[:2]

        # ── Push RAW frame BEFORE any drawing ─────────────────────────────────
        # Use a copy so drawing on annotated doesn't affect raw stream
        pusher_raw.enqueue(orig_img.copy())

        # ── Preprocess ────────────────────────────────────────────────────────
        rgb_img = cv.cvtColor(orig_img, cv.COLOR_BGR2RGB)
        lb_img, scale, pad_x, pad_y = letterbox(rgb_img, target=640)
        img = lb_img.astype(np.float32)
        img[:, :, 0] -= mean[0];  img[:, :, 1] -= mean[1];  img[:, :, 2] -= mean[2]
        img /= var[0]
        img = img.transpose(2, 0, 1)

        # ── Inference ─────────────────────────────────────────────────────────
        try:
            data = yolov3.nn_inference(
                [img], platform='ONNX', reorder='2 1 0',
                output_tensor=3, output_format=output_format.OUT_FORMAT_FLOAT32
            )
        except Exception as e:
            print(f'[ERROR] nn_inference: {e} — skipping frame')
            continue

        # ── Reshape ───────────────────────────────────────────────────────────
        input0_data = data[2].reshape(SPAN, LISTSIZE, GRID0, GRID0)
        input1_data = data[1].reshape(SPAN, LISTSIZE, GRID1, GRID1)
        input2_data = data[0].reshape(SPAN, LISTSIZE, GRID2, GRID2)
        input_data  = [
            np.transpose(input0_data, (2, 3, 0, 1)),
            np.transpose(input1_data, (2, 3, 0, 1)),
            np.transpose(input2_data, (2, 3, 0, 1)),
        ]

        # ── Postprocess + draw on annotated copy ──────────────────────────────
        boxes, scores, classes = yolov3_post_process(input_data)
        n_det = 0
        if boxes is not None:
            n_det = len(boxes)
            boxes_px = unletterbox_boxes(
                boxes, scale, pad_x, pad_y, orig_w, orig_h, target=640)
            draw_px(orig_img, boxes_px, scores, classes)

        # ── FPS + detection count overlay on detection stream ─────────────────
        fps_times.append(time.time())
        fps = 0.0
        if len(fps_times) >= 2:
            fps = (len(fps_times) - 1) / (fps_times[-1] - fps_times[0])

        cv.putText(orig_img, f'FPS: {fps:.1f}  Det: {n_det}',
                   (10, 40), cv.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)

        # ── Push ANNOTATED frame to detection stream ───────────────────────────
        pusher_det.enqueue(orig_img)

        if len(fps_times) % 60 == 0:
            print(f'[INFO] FPS: {fps:.2f}  detections: {n_det}')

    # ── Cleanup ───────────────────────────────────────────────────────────────
    # Stop the RTSP reader first so no new frames enter the pipeline
    reader.stop()

    # Signal both pushers to stop accepting new frames
    pusher_raw._running = False
    pusher_det._running = False

    # Give writer threads 2s to finish their current write then exit
    # Don't call pusher.stop() which does a blocking join — the asnn driver
    # tears down shared memory during Python atexit and can segfault if our
    # threads are still alive when that happens.
    import time as _time
    _time.sleep(0.5)

    # Close FFmpeg stdin so it flushes and exits cleanly
    for p in [pusher_raw, pusher_det]:
        try:
            if p.proc and p.proc.poll() is None:
                p.proc.stdin.close()
                p.proc.wait(timeout=3)
        except Exception:
            pass

    print('Stopped.')


if __name__ == '__main__':
    main()
