#!/usr/bin/env python3
"""
run.py — Unified launcher

Starts in order:
  1. Shared frame broker   (opens RTSP once per camera)
  2. Fire detection        (reads from broker queue)
  3. Person detection      (reads from broker queue)

Usage:
    python run.py \
        --library /path/to/libnn.so \
        --model   /path/to/person.nbg \
        [--display]
"""

import time
import signal
import argparse
import threading
import queue
import sys

# ── shared broker ────────────────────────────────────────
from shared_stream import start_all, stop_all, brokers

# ── fire detection (adapted version) ─────────────────────
import fire          # your modified fire.py

# ── person detection ─────────────────────────────────────
# We replicate person1.py's worker inline here so both scripts
# share one process and the broker queues stay in-process.
import os
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
    "rtsp_transport;tcp|fflags;nobuffer+discardcorrupt"
    "|flags;low_delay|analyzeduration;500000|probesize;500000"
    "|stimeout;10000000|tcp_nodelay;1"
)

import numpy as np
import cv2 as cv
import json
from datetime import datetime
import paho.mqtt.client as mqtt

from asnn.api import asnn
from asnn.types import *

# ── YOLO constants (from person1.py) ─────────────────────
GRID0=20; GRID1=40; GRID2=80; LISTSIZE=65; SPAN=1; NUM_CLS=1
OBJ_THRESH=0.3; NMS_THRESH=0.5
mean=[0,0,0]; var=[255]
constant_martix = np.array([[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]]).T
PERSON_CLASSES = ("Person",)

MQTT_BROKER_ADDR  = "localhost"
MQTT_PORT         = 1883
MQTT_USER         = "rajat"
MQTT_PASS         = "asdf"
MQTT_TOPIC_DET    = "atomo/store/person_detections"
MQTT_TOPIC_STATS  = "atomo/store/detection_stats"
MQTT_PUB_INTERVAL = 0.5


def sigmoid(x): return 1/(1+np.exp(-x))
def softmax(x, axis=0):
    x=np.exp(x); return x/x.sum(axis=axis, keepdims=True)

def process_yolo(inp):
    gh, gw = map(int, inp.shape[0:2])
    bcp = sigmoid(inp[..., :NUM_CLS])
    b0=softmax(inp[...,NUM_CLS:NUM_CLS+16],-1)
    b1=softmax(inp[...,NUM_CLS+16:NUM_CLS+32],-1)
    b2=softmax(inp[...,NUM_CLS+32:NUM_CLS+48],-1)
    b3=softmax(inp[...,NUM_CLS+48:NUM_CLS+64],-1)
    res=np.zeros((gh,gw,1,4))
    res[...,0]=np.dot(b0,constant_martix)[...,0]
    res[...,1]=np.dot(b1,constant_martix)[...,0]
    res[...,2]=np.dot(b2,constant_martix)[...,0]
    res[...,3]=np.dot(b3,constant_martix)[...,0]
    col=np.tile(np.arange(0,gw),gw).reshape(-1,gw)
    row=np.tile(np.arange(0,gh).reshape(-1,1),gh)
    col=col.reshape(gh,gw,1,1); row=row.reshape(gh,gw,1,1)
    grid=np.concatenate((col,row),axis=-1)
    res[...,0:2]=(0.5-res[...,0:2]+grid)/(gw,gh)
    res[...,2:4]=(0.5+res[...,2:4]+grid)/(gw,gh)
    return res, bcp

def filter_boxes(boxes, bcp):
    bc=np.argmax(bcp,axis=-1); bcs=np.max(bcp,axis=-1)
    pos=np.where(bcs>=OBJ_THRESH)
    return boxes[pos], bc[pos], bcs[pos]

def nms_boxes(boxes, scores):
    x1=boxes[:,0];y1=boxes[:,1];x2=boxes[:,2];y2=boxes[:,3]
    areas=(x2-x1)*(y2-y1); order=scores.argsort()[::-1]; keep=[]
    while order.size>0:
        i=order[0]; keep.append(i)
        xx1=np.maximum(x1[i],x1[order[1:]]); yy1=np.maximum(y1[i],y1[order[1:]])
        xx2=np.minimum(x2[i],x2[order[1:]]); yy2=np.minimum(y2[i],y2[order[1:]])
        w1=np.maximum(0.0,xx2-xx1+1e-5); h1=np.maximum(0.0,yy2-yy1+1e-5)
        inter=w1*h1; ovr=inter/(areas[i]+areas[order[1:]]-inter)
        inds=np.where(ovr<=NMS_THRESH)[0]; order=order[inds+1]
    return np.array(keep)

def yolov3_post_process(input_data):
    boxes,classes,scores=[],[],[]
    for i in range(3):
        r,c=process_yolo(input_data[i]); b,cl,s=filter_boxes(r,c)
        boxes.append(b); classes.append(cl); scores.append(s)
    boxes=np.concatenate(boxes); classes=np.concatenate(classes); scores=np.concatenate(scores)
    nb,nc,ns=[],[],[]
    for c in set(classes):
        inds=np.where(classes==c); b=boxes[inds]; cl=classes[inds]; s=scores[inds]
        keep=nms_boxes(b,s); nb.append(b[keep]); nc.append(cl[keep]); ns.append(s[keep])
    if not nc and not ns: return None,None,None
    return np.concatenate(nb),np.concatenate(ns),np.concatenate(nc)


class PersonMQTT:
    def __init__(self):
        self.client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
        self.connected = False
        self.last_pub = 0

    def connect(self):
        self.client.on_connect = lambda c,u,f,rc,p=None: setattr(self,'connected',rc==0)
        self.client.username_pw_set(MQTT_USER, MQTT_PASS)
        try:
            self.client.connect(MQTT_BROKER_ADDR, MQTT_PORT, 60)
            self.client.loop_start()
        except Exception as e:
            print(f"[MQTT-Person] {e}")

    def publish(self, topic, payload):
        now=time.time()
        if now-self.last_pub < MQTT_PUB_INTERVAL: return
        if self.connected:
            try:
                self.client.publish(topic, json.dumps(payload), qos=1)
                self.last_pub=now
            except: pass

    def disconnect(self):
        self.client.loop_stop(); self.client.disconnect()


person_mqtt = PersonMQTT()


def person_worker(cam_id: str, broker, yolov3):
    """Reads from broker's person queue, runs ASNN inference, publishes to MQTT."""
    print(f"[Person:{cam_id}] Inference worker ready")
    while True:
        try:
            frame = broker.person_queue.get(timeout=1.0)
        except queue.Empty:
            continue

        img = cv.resize(frame, (640,640)).astype(np.float32)
        img[:,:,0]-=mean[0]; img[:,:,1]-=mean[1]; img[:,:,2]-=mean[2]
        img/=var[0]; img=img.transpose(2,0,1)

        data = yolov3.nn_inference(
            [img], platform='ONNX', reorder='2 1 0',
            output_tensor=3, output_format=output_format.OUT_FORMAT_FLOAT32
        )

        i0=data[2].reshape(SPAN,LISTSIZE,GRID0,GRID0)
        i1=data[1].reshape(SPAN,LISTSIZE,GRID1,GRID1)
        i2=data[0].reshape(SPAN,LISTSIZE,GRID2,GRID2)
        input_data=[
            np.transpose(i0,(2,3,0,1)),
            np.transpose(i1,(2,3,0,1)),
            np.transpose(i2,(2,3,0,1)),
        ]

        boxes, scores, classes = yolov3_post_process(input_data)

        detections = []
        if boxes is not None:
            h, w = frame.shape[:2]
            for box, score in zip(boxes, scores):
                x1=int(box[0]*w); y1=int(box[1]*h)
                x2=int(box[2]*w); y2=int(box[3]*h)
                detections.append({
                    "bbox": [x1,y1,x2,y2],
                    "confidence": float(score),
                    "gender": "Unknown"
                })

        person_mqtt.publish(MQTT_TOPIC_DET, {
            "timestamp":       time.time(),
            "datetime":        datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            "camera_id":       cam_id,
            "detection_count": len(detections),
            "detections":      detections,
        })


# ──────────────────────────────────────────────────────────
#  MAIN LAUNCHER
# ──────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--library", required=True, help="Path to ASNN .so library")
    parser.add_argument("--model",   required=True, help="Path to person .nbg model")
    parser.add_argument("--display", action="store_true")
    args_p = parser.parse_args()

    # ── 1. Start shared broker (opens RTSP once per camera) ──
    print("="*60)
    print("Starting shared frame broker...")
    start_all()
    time.sleep(1.5)          # let captures stabilise

    # ── 2. Start fire detection workers (one thread per cam) ──
    print("Starting fire detection...")
    fire.mqtt_mgr.start()
    for cam_id, broker in brokers.items():
        t = threading.Thread(
            target=fire.camera_worker,
            args=(cam_id, broker),
            daemon=True
        )
        t.start()

    # ── 3. Start person detection workers ──────────────────
    print("Initialising ASNN person model...")
    yolov3 = asnn('Electron')
    yolov3.nn_init(library=args_p.library, model=args_p.model, level=0)
    person_mqtt.connect()
    time.sleep(0.5)

    print("Starting person detection...")
    for cam_id, broker in brokers.items():
        t = threading.Thread(
            target=person_worker,
            args=(cam_id, broker, yolov3),
            daemon=True
        )
        t.start()

    print("="*60)
    print("All systems running.")
    print(f"Cameras: {list(brokers.keys())}")
    print("MediaMTX streams available at:")
    for cam_id in brokers:
        print(f"   rtsp://localhost:8554/{cam_id}")
    print("Ctrl-C to stop.")
    print("="*60)

    def _shutdown(sig, frame):
        print("\nShutting down...")
        fire.mqtt_mgr.stop()
        person_mqtt.disconnect()
        stop_all()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    while True:
        time.sleep(1)


if __name__ == "__main__":
    import signal
    main()
