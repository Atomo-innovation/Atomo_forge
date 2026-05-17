import numpy as np
import cv2 as cv
import argparse
from asnn.api import asnn
from asnn.types import *
import os
import threading
from collections import deque
import time

INPUT_SIZE = 640
CONF_TH = 0.1          # object confidence threshold
NMS_TH = 0.4
LISTSIZE = 65
NUM_CLS = 1

CLASSES = ("person",)

constant_martix = np.array([[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]]).T

# Frame buffer for RTSP
frame_buffer = deque(maxlen=2)
processing_frame = None
frame_lock = threading.Lock()
running = True

def sigmoid(x):
    return 1 / (1 + np.exp(-x))

def softmax(x, axis=-1):
    e_x = np.exp(x - np.max(x, axis=axis, keepdims=True))
    return e_x / np.sum(e_x, axis=axis, keepdims=True)

def process_single_scale(tensor):
    grid_h, grid_w = tensor.shape[:2]
    class_probs = sigmoid(tensor[..., :NUM_CLS])

    dfl_0 = softmax(tensor[..., NUM_CLS:NUM_CLS+16], axis=-1)
    dfl_1 = softmax(tensor[..., NUM_CLS+16:NUM_CLS+32], axis=-1)
    dfl_2 = softmax(tensor[..., NUM_CLS+32:NUM_CLS+48], axis=-1)
    dfl_3 = softmax(tensor[..., NUM_CLS+48:NUM_CLS+64], axis=-1)

    dist = np.zeros((grid_h, grid_w, 4))
    dist[..., 0] = (dfl_0 @ constant_martix)[..., 0]
    dist[..., 1] = (dfl_1 @ constant_martix)[..., 0]
    dist[..., 2] = (dfl_2 @ constant_martix)[..., 0]
    dist[..., 3] = (dfl_3 @ constant_martix)[..., 0]

    col = np.tile(np.arange(0, grid_w), (grid_h, 1))
    row = np.tile(np.arange(0, grid_h).reshape(-1, 1), (1, grid_w))
    grid = np.stack((col, row), axis=-1).astype(np.float32)

    boxes = np.zeros((grid_h, grid_w, 1, 4))
    boxes[..., 0] = ((grid[..., 0] + 0.5 - dist[..., 0]) / grid_w)[..., np.newaxis]
    boxes[..., 1] = ((grid[..., 1] + 0.5 - dist[..., 1]) / grid_h)[..., np.newaxis]
    boxes[..., 2] = ((grid[..., 0] + 0.5 + dist[..., 2]) / grid_w)[..., np.newaxis]
    boxes[..., 3] = ((grid[..., 1] + 0.5 + dist[..., 3]) / grid_h)[..., np.newaxis]

    return boxes, class_probs

def filter_boxes(boxes, class_probs, obj_thresh):
    scores = np.max(class_probs, axis=-1)
    class_ids = np.argmax(class_probs, axis=-1)
    mask = scores >= obj_thresh

    if not np.any(mask):
        return None, None, None

    boxes = boxes[mask].reshape(-1, 4)
    scores = scores[mask]
    class_ids = class_ids[mask]
    return boxes, class_ids, scores

def nms_boxes(boxes, scores, iou_thresh):
    x1, y1, x2, y2 = boxes[:,0], boxes[:,1], boxes[:,2], boxes[:,3]
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

        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h
        ovr = inter / (areas[i] + areas[order[1:]] - inter + 1e-7)
        inds = np.where(ovr <= iou_thresh)[0]
        order = order[inds + 1]

    return np.array(keep)

def postprocess(outputs, frame):
    scales = []
    for flat in outputs:
        total = flat.shape[0]
        grid_cells = total // LISTSIZE
        grid_h = grid_w = int(np.sqrt(grid_cells))
        tensor = flat.reshape(LISTSIZE, grid_h, grid_w)
        tensor = np.transpose(tensor, (1, 2, 0))
        scales.append(tensor)

    all_boxes, all_scores, all_class_ids = [], [], []

    for tensor in scales:
        boxes, class_probs = process_single_scale(tensor)
        boxes, class_ids, scores = filter_boxes(boxes, class_probs, CONF_TH)
        if boxes is not None:
            all_boxes.append(boxes)
            all_scores.append(scores)
            all_class_ids.append(class_ids)

    if not all_boxes:
        return

    boxes_all = np.vstack(all_boxes)
    scores_all = np.hstack(all_scores)
    class_ids_all = np.hstack(all_class_ids)

    final_boxes, final_scores, final_class_ids = [], [], []
    for c in set(class_ids_all):
        mask = class_ids_all == c
        boxes_c = boxes_all[mask]
        scores_c = scores_all[mask]
        keep = nms_boxes(boxes_c, scores_c, NMS_TH)
        if len(keep) > 0:
            final_boxes.append(boxes_c[keep])
            final_scores.append(scores_c[keep])
            final_class_ids.append([c] * len(keep))

    if not final_boxes:
        return

    final_boxes = np.vstack(final_boxes)
    final_scores = np.hstack(final_scores)
    final_class_ids = np.hstack(final_class_ids)

    for box, score, cl in zip(final_boxes, final_scores, final_class_ids):
        x1, y1, x2, y2 = box
        
        x1 *= frame.shape[1]
        y1 *= frame.shape[0]
        x2 *= frame.shape[1]
        y2 *= frame.shape[0]
        
        left = max(0, np.floor(x1 + 0.5).astype(int))
        top = max(0, np.floor(y1 + 0.5).astype(int))
        right = min(frame.shape[1], np.floor(x2 + 0.5).astype(int))
        bottom = min(frame.shape[0], np.floor(y2 + 0.5).astype(int))

        cv.rectangle(frame, (left, top), (right, bottom), (255, 0, 0), 2)
        cv.putText(frame, '{0} {1:.2f}'.format(CLASSES[cl].strip(), score),
                    (left, top - 6),
                    cv.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

def capture_frames(cap):
    """Background thread for capturing RTSP frames"""
    global frame_buffer, running
    frame_count = 0
    last_frame_time = time.time()
    
    while running:
        ret, frame = cap.read()
        if not ret:
            print("RTSP stream lost. Attempting to reconnect...")
            time.sleep(1)
            continue
            
        current_time = time.time()
        frame_count += 1
        
        # Calculate and display FPS occasionally
        if frame_count % 30 == 0:
            elapsed = current_time - last_frame_time
            fps = 30 / elapsed if elapsed > 0 else 0
            print(f"Capture FPS: {fps:.1f}")
            last_frame_time = current_time
        
        with frame_lock:
            if len(frame_buffer) >= frame_buffer.maxlen:
                frame_buffer.popleft()
            frame_buffer.append(frame)

def get_video_source(source_type, source_path, rtsp_user=None, rtsp_password=None):
    """Open video source based on type with real-time optimizations"""
    if source_type == "camera":
        cap = cv.VideoCapture(int(source_path))
        cap.set(cv.CAP_PROP_FRAME_WIDTH, 1920)
        cap.set(cv.CAP_PROP_FRAME_HEIGHT, 1080)
        cap.set(cv.CAP_PROP_FPS, 30)
        cap.set(cv.CAP_PROP_BUFFERSIZE, 1)  # Minimize buffer for real-time
        return cap
    
    elif source_type == "video":
        cap = cv.VideoCapture(source_path)
        return cap
    
    elif source_type == "rtsp":
        # Enhanced RTSP settings for real-time
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
        
        # Add credentials if provided
        rtsp_url = source_path
        if rtsp_user and rtsp_password and "@" not in rtsp_url:
            parts = rtsp_url.split("://")
            if len(parts) == 2:
                rtsp_url = f"rtsp://{rtsp_user}:{rtsp_password}@{parts[1]}"
        
        # Try multiple TCP transport methods
        urls_to_try = [
            rtsp_url,
            rtsp_url + "?rtsp_transport=tcp&timeout=0",  # No timeout
            rtsp_url + "&rtsp_transport=tcp&buffer_size=1024",  # Small buffer
        ]
        
        for url in urls_to_try:
            print(f"Trying RTSP URL: {url}")
            cap = cv.VideoCapture(url, cv.CAP_FFMPEG)
            if cap.isOpened():
                # Optimize for real-time
                cap.set(cv.CAP_PROP_BUFFERSIZE, 1)  # Minimize internal buffer
                cap.set(cv.CAP_PROP_FPS, 30)  # Request 30fps
                
                # Get actual properties
                actual_fps = cap.get(cv.CAP_PROP_FPS)
                actual_width = int(cap.get(cv.CAP_PROP_FRAME_WIDTH))
                actual_height = int(cap.get(cv.CAP_PROP_FRAME_HEIGHT))
                
                print(f"RTSP connected: {actual_width}x{actual_height} @ {actual_fps}fps")
                return cap
        
        # Fallback to GStreamer pipeline with low latency
        print("Trying GStreamer low-latency pipeline...")
        gst_pipeline = f'rtspsrc location={rtsp_url} protocols=tcp latency=0 buffer-mode=0 ! '
        gst_pipeline += 'rtph264depay ! h264parse ! avdec_h264 ! videoconvert ! '
        gst_pipeline += 'video/x-raw,format=BGR ! appsink max-buffers=1 drop=true'
        
        cap = cv.VideoCapture(gst_pipeline, cv.CAP_GSTREAMER)
        if cap.isOpened():
            print("GStreamer RTSP connected with low latency")
            return cap
        
        return None
    else:
        return None

# -------------------- Main --------------------
parser = argparse.ArgumentParser(description='Real-time YOLOv8n detection on Electron NPU')
parser.add_argument("--model", required=True, help="Path to .nb model file")
parser.add_argument("--library", required=True, help="Path to .so library file")
parser.add_argument("--source_type", choices=["camera", "video", "rtsp"], default="camera",
                   help="Type of input source")
parser.add_argument("--source", required=True, 
                   help="Source path: camera device number, video file, or RTSP URL")
parser.add_argument("--output", help="Output video file path (optional)")
parser.add_argument("--display", action="store_true", default=True, help="Display output window")
parser.add_argument("--rtsp_user", help="RTSP username")
parser.add_argument("--rtsp_password", help="RTSP password")
parser.add_argument("--no_display", action="store_true", help="Disable display window (for headless)")
parser.add_argument("--skip_frames", type=int, default=0, 
                   help="Skip frames for RTSP to reduce load (0 = process all)")
args = parser.parse_args()

# Initialize NPU
yolov = asnn('Electron')
print("asnn Version:", yolov.get_nn_version())
yolov.nn_init(library=args.library, model=args.model, level=0)

# Open video source with real-time optimizations
cap = get_video_source(args.source_type, args.source, args.rtsp_user, args.rtsp_password)
if not cap or not cap.isOpened():
    print(f"Cannot open {args.source_type} source: {args.source}")
    exit()

# Get video properties
fps = cap.get(cv.CAP_PROP_FPS)
if fps <= 0 or fps > 60:
    fps = 30  # Default for RTSP
width = int(cap.get(cv.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv.CAP_PROP_FRAME_HEIGHT))

print(f"Source: {width}x{height} @ {fps:.1f}fps")

# Initialize video writer if output is specified
out = None
if args.output:
    fourcc = cv.VideoWriter_fourcc(*'mp4v')
    out = cv.VideoWriter(args.output, fourcc, fps, (width, height))
    print(f"Saving output to: {args.output}")

# Start capture thread for RTSP
if args.source_type == "rtsp":
    capture_thread = threading.Thread(target=capture_frames, args=(cap,))
    capture_thread.daemon = True
    capture_thread.start()
    print("RTSP capture thread started")

# Real-time detection loop
frame_count = 0
skip_counter = 0
fps_counter = 0
fps_start_time = time.time()
display_enabled = not args.no_display and args.display

try:
    while running:
        loop_start = time.time()
        
        # Get frame (with thread safety for RTSP)
        if args.source_type == "rtsp":
            with frame_lock:
                if len(frame_buffer) > 0:
                    frame = frame_buffer[-1].copy()  # Get latest frame
                else:
                    time.sleep(0.001)
                    continue
        else:
            ret, frame = cap.read()
            if not ret:
                print("End of stream")
                break
        
        frame_count += 1
        skip_counter += 1
        
        # Skip frames if requested (for RTSP load reduction)
        if args.skip_frames > 0 and skip_counter <= args.skip_frames:
            if skip_counter >= args.skip_frames:
                skip_counter = 0
            else:
                continue
        
        # Preprocessing
        img = cv.resize(frame, (INPUT_SIZE, INPUT_SIZE)).astype(np.float32)
        img /= 255.0
        img = img.transpose(2, 0, 1)
        img = np.expand_dims(img, 0)
        img = np.ascontiguousarray(img)
        
        # Inference
        inference_start = time.time()
        outputs = yolov.nn_inference(
            [img],
            platform='ONNX',
            reorder='2 1 0',
            output_tensor=3,
            output_format=output_format.OUT_FORMAT_FLOAT32
        )
        inference_time = time.time() - inference_start
        
        # Postprocess and draw
        postprocess_start = time.time()
        postprocess(outputs, frame)
        postprocess_time = time.time() - postprocess_start
        
        # Calculate and display FPS
        fps_counter += 1
        if time.time() - fps_start_time >= 1.0:
            actual_fps = fps_counter / (time.time() - fps_start_time)
            cv.putText(frame, f"FPS: {actual_fps:.1f}", (10, 30),
                      cv.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            print(f"Performance - FPS: {actual_fps:.1f}, Inference: {inference_time*1000:.1f}ms, Postprocess: {postprocess_time*1000:.1f}ms")
            fps_counter = 0
            fps_start_time = time.time()
        
        # Save output
        if out:
            out.write(frame)
        
        # Display
        if display_enabled:
            cv.imshow("Real-time YOLO Detection", frame)
            key = cv.waitKey(1) & 0xFF
            if key == ord('q'):
                break
            elif key == ord('s'):
                cv.imwrite(f"snapshot_{frame_count}.jpg", frame)
                print(f"Snapshot saved: snapshot_{frame_count}.jpg")
        
        # Control loop speed if needed
        loop_time = time.time() - loop_start
        if loop_time < 0.01:  # Cap at ~100fps max
            time.sleep(0.001)

except KeyboardInterrupt:
    print("\nInterrupted by user")

finally:
    running = False
    time.sleep(0.5)  # Give capture thread time to exit
    
    # Cleanup
    if args.source_type == "rtsp":
        cap.release()
    else:
        cap.release()
    
    if out:
        out.release()
    
    cv.destroyAllWindows()
    if hasattr(yolov, 'nn_unload'):
        yolov.nn_unload()
    
    print(f"\nProcessing complete!")
    print(f"Total frames processed: {frame_count}")
