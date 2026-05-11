import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Square, ImageIcon, Circle, Play, Pause, Zap } from "lucide-react";
import type { CameraConfig } from "@/pages/Dashboard";
import { useModels } from "@/hooks/useModels";
import ModelSelector from "./ModelSelector";
import LiveStats from "./LiveStats";
import { subscribeUniversalSession } from "@/services/universalSessionWs";

interface Props {
  camera: CameraConfig | null;
  onBack: () => void;
  onUpdateCamera: (cameraId: string, patch: Partial<CameraConfig>) => void;
}

const LiveViewScreen = ({ camera, onBack, onUpdateCamera }: Props) => {
  const [processing, setProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const { models } = useModels();
  const [runError, setRunError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const unsubscribeWsRef = useRef<null | (() => void)>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameImgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pendingFrameRef = useRef<{ jpeg: string | null; dets: Detection[] } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRenderAtRef = useRef(0);

  type Detection = { class_id?: number; class_name?: string; score?: number; box: [number, number, number, number] };

  const stopWs = () => {
    const unsub = unsubscribeWsRef.current;
    unsubscribeWsRef.current = null;
    try {
      unsub?.();
    } catch {
      // ignore
    }
  };

  const stopWebcam = () => {
    const s = mediaStreamRef.current;
    mediaStreamRef.current = null;
    if (s) s.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const drawBoxes = (ctx: CanvasRenderingContext2D, detections: Detection[]) => {
    const canvas = ctx.canvas;
    const W = canvas.width;
    const H = canvas.height;
    detections.forEach((d) => {
      if (!d?.box || d.box.length !== 4) return;
      const [x1n, y1n, x2n, y2n] = d.box;
      const x1 = x1n * W;
      const y1 = y1n * H;
      const x2 = x2n * W;
      const y2 = y2n * H;
      const bw = x2 - x1;
      const bh = y2 - y1;

      ctx.save();
      ctx.shadowColor = "rgba(59,130,246,0.9)";
      ctx.shadowBlur = 12;
      ctx.strokeStyle = "rgba(59,130,246,0.95)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, bw, bh);
      ctx.restore();

      ctx.fillStyle = "rgba(59,130,246,0.08)";
      ctx.fillRect(x1, y1, bw, bh);

      const label = `${d.class_name ?? `cls:${d.class_id ?? "?"}`}${typeof d.score === "number" ? ` ${(d.score * 100).toFixed(1)}%` : ""}`;
      ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
      const padX = 6;
      const padY = 4;
      const tw = ctx.measureText(label).width;
      const th = 14;
      const lx = Math.max(0, Math.min(W - (tw + padX * 2), x1));
      const ly = Math.max(th + 2, y1);
      ctx.fillStyle = "rgba(17,24,39,0.85)";
      ctx.fillRect(lx, ly - th - padY, tw + padX * 2, th + padY);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(label, lx + padX, ly - 4);
    });
  };

  const renderFrameToCanvas = (jpegB64: string | null, detections: Detection[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!jpegB64) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(0,0,0,0.03)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawBoxes(ctx, detections);
      return;
    }

    let img = frameImgRef.current;
    if (!img) {
      img = new Image();
      frameImgRef.current = img;
    }

    img.onload = () => {
      if (canvas.width !== img!.naturalWidth || canvas.height !== img!.naturalHeight) {
        canvas.width = img!.naturalWidth;
        canvas.height = img!.naturalHeight;
      }
      ctx.drawImage(img!, 0, 0);
      drawBoxes(ctx, detections);
    };
    img.src = `data:image/jpeg;base64,${jpegB64}`;
  };

  const scheduleRender = () => {
    // Universal may send frames faster than the browser can decode/draw.
    // Cap canvas rendering to reduce CPU without breaking UX.
    const MAX_FPS = 15;
    const minDt = 1000 / MAX_FPS;
    const now = performance.now();
    if (now - lastRenderAtRef.current < minDt) return;
    lastRenderAtRef.current = now;
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const p = pendingFrameRef.current;
      if (!p) return;
      renderFrameToCanvas(p.jpeg, p.dets);
    });
  };

  // Wait until previously released V4L2 devices are actually closed by the
  // kernel before another process tries to open them. Calling stop() on a
  // MediaStreamTrack returns immediately, but /dev/videoN can stay BUSY for a
  // few hundred ms on some boards.
  const waitMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const startWebcamPreview = async () => {
    // Browsers only expose mediaDevices in a "secure context" (HTTPS or
    // http://localhost). On a board accessed via http://192.168.x.x it is
    // undefined and the next call would throw an unrelated TypeError.
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md || typeof md.getUserMedia !== "function") {
      setRunError(
        "Camera access is not available in this browser context. Open the app over HTTPS (or http://localhost) — browsers block getUserMedia on insecure LAN URLs.",
      );
      return;
    }

    if (!videoRef.current) return;
    stopWebcam();

    // Try increasingly permissive constraints. Many board USB cams only expose
    // a couple of YUYV modes; the browser default ({ video: true } ≈ 720p+) can
    // fail format negotiation, which manifests as the camera LED blinking once
    // and then no stream.
    const tryGetStream = async (): Promise<MediaStream> => {
      const attempts: MediaStreamConstraints[] = [
        {
          audio: false,
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 15, max: 30 },
            facingMode: { ideal: "environment" },
          },
        },
        {
          audio: false,
          video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 10, max: 15 } },
        },
        { audio: false, video: true },
      ];
      let lastErr: unknown = null;
      for (const c of attempts) {
        try {
          return await md.getUserMedia(c);
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error("Failed to access webcam");
    };

    try {
      const stream = await tryGetStream();
      // While we awaited the permission prompt, React may have re-rendered and
      // unmounted the <video> (e.g. processing flipped to true, camera changed,
      // or LiveView was closed). videoRef.current is then null — without this
      // guard we'd hit "Cannot set properties of null (setting 'srcObject')".
      const el = videoRef.current;
      if (!el) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      mediaStreamRef.current = stream;
      el.srcObject = stream;
      try {
        await el.play();
      } catch {
        // Autoplay can be blocked; the element is muted+playsInline so it will
        // start playing on first user interaction. Not a fatal error.
      }
    } catch (e) {
      const err = e as DOMException & { name?: string };
      const name = err?.name || "";
      let msg: string;
      if (name === "NotAllowedError") {
        msg = "Camera permission denied. Allow camera access for this site in the browser, then retry.";
      } else if (name === "NotFoundError") {
        msg = "No USB camera found. Check `lsusb` and that /dev/video0 exists on the board.";
      } else if (name === "NotReadableError") {
        msg =
          "Camera is busy. Another process (often a previous AI session) still holds /dev/video0. Stop processing, wait a moment, or unplug/replug the camera, then retry.";
      } else if (name === "OverconstrainedError") {
        msg = "Camera does not support the requested resolution/format. Try a different USB camera.";
      } else {
        msg = e instanceof Error ? e.message : "Failed to access webcam";
      }
      setRunError(msg);
    }
  };

  const connectWsAttach = (sid: string) => {
    stopWs();
    setRunStatus("connecting");
    pendingFrameRef.current = { jpeg: null, dets: [] };
    lastRenderAtRef.current = 0;
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    unsubscribeWsRef.current = subscribeUniversalSession(
      sid,
      {
        onStatus: ({ status }) => {
          if (status) setRunStatus(status);
        },
        onError: (err) => {
          setRunError(err);
          setProcessing(false);
        },
        onMessage: (msg) => {
          // Surface backend errors from detect.py (e.g. "Cannot open: usb:0"
          // when the V4L2 device is busy or missing). Without this the UI just
          // sits silently on "connecting…" and the user sees the camera LED
          // blink once and nothing happens.
          if (msg?.type === "log") {
            const level = String(msg.level || "").toLowerCase();
            const text = typeof msg.message === "string" ? msg.message : "";
            if (text && (level === "err" || level === "error")) {
              setRunError(text);
              setProcessing(false);
            } else if (text && level === "warn") {
              setRunStatus(text);
            }
            return;
          }
          if (msg?.type !== "inference") return;
          const jpeg = typeof msg.jpeg === "string" ? msg.jpeg : null;
          const dets = Array.isArray(msg.detections) ? (msg.detections as Detection[]) : [];
          pendingFrameRef.current = { jpeg, dets };
          scheduleRender();
        },
      },
      // We already start inference via REST when creating a session; only attach here.
      { lingerMs: 15000, autoStart: false },
    );
  };

  const startProcessing = async () => {
    if (!camera) return;
    // If this camera already has a running session, just attach to it.
    if (camera.inferenceSessionId) {
      setRunError(null);
      setSessionId(camera.inferenceSessionId);
      setProcessing(true);
      connectWsAttach(camera.inferenceSessionId);
      return;
    }
    const model = selectedModel ? models.find((m) => m.id === selectedModel) : null;
    if (!model) {
      setRunError("Select a model first");
      setModelPickerOpen(true);
      return;
    }

    setRunError(null);
    setRunStatus(null);
    setSessionId(null);

    try {
      const inputType = camera.type === "rtsp" ? "rtsp" : "webcam";
      const inputValue =
        inputType === "rtsp"
          ? camera.rtspUrl?.trim()
          : (camera.device ?? (camera.type === "csi" ? "csi:0" : "usb:0"));

      if (!inputValue) throw new Error("Camera input is missing (RTSP URL / device)");

      // The browser preview is currently holding /dev/videoN. The backend can
      // only open the camera once the kernel has actually released the node;
      // calling stop() returns immediately but the close can take ~100-500 ms
      // on lower-end boards. Without this, the backend reports "device busy"
      // and you see the camera LED blink and die.
      if (inputType === "webcam") {
        stopWebcam();
        await waitMs(300);
      }

      const res = await fetch("/universal/api/inference/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelName: model.name,
          inputType,
          inputValue,
          objThresh: 0.25,
          nmsThresh: 0.45,
          logLevel: 0,
          // Lower JPEG quality reduces CPU (encode/decode) and bandwidth.
          jpegQuality: 60,
        }),
      });
      if (!res.ok) throw new Error(`Inference start failed (${res.status})`);

      const data = (await res.json()) as { sessionId?: string; error?: string };
      if (!data.sessionId) throw new Error(data.error || "Inference start missing sessionId");
      setSessionId(data.sessionId);
      connectWsAttach(data.sessionId);
      setProcessing(true);
      onUpdateCamera(camera.id, {
        model: model.name,
        inferenceSessionId: data.sessionId,
        inferenceModelId: model.id,
        inferenceStartedAt: Date.now(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start processing";
      setRunError(msg);
      setProcessing(false);
    }
  };

  const stopProcessing = async () => {
    const sid = sessionId;
    // Ask server to stop immediately over WS.
    // NOTE: if you want "Stop" to truly stop the backend, we still use REST below.
    stopWs();
    setProcessing(false);
    setRunStatus(null);
    setSessionId(null);
    if (camera?.id) {
      onUpdateCamera(camera.id, {
        inferenceSessionId: undefined,
        inferenceModelId: undefined,
        inferenceStartedAt: undefined,
      });
    }

    if (!sid) return;
    try {
      await fetch(`/universal/api/inference/stop/${encodeURIComponent(sid)}`, { method: "POST" });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    setSelectedModel(camera?.inferenceModelId ?? null);
    setModelPickerOpen(false);
    setRunError(null);
    setRunStatus(null);
    setSessionId(camera?.inferenceSessionId ?? null);
    setProcessing(Boolean(camera?.inferenceSessionId));
    stopWs();
    stopWebcam();
    pendingFrameRef.current = null;
    lastRenderAtRef.current = 0;
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera?.id]);

  const selectedModelName =
    selectedModel ? models.find((m) => m.id === selectedModel)?.name ?? "Selected model" : null;

  useEffect(() => {
    if (!camera?.inferenceSessionId) return;
    connectWsAttach(camera.inferenceSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera?.id, camera?.inferenceSessionId]);

  useEffect(() => {
    if (!camera) return;
    if (processing) return;
    if (camera.type === "usb" || camera.type === "csi") {
      void startWebcamPreview();
    }
    return () => stopWebcam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera?.id, camera?.type, processing]);

  useEffect(() => {
    return () => {
      stopWs();
      stopWebcam();
      pendingFrameRef.current = null;
      lastRenderAtRef.current = 0;
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{camera?.name || "Live View"}</h1>
          <p className="text-sm text-muted-foreground">
            {camera?.type.toUpperCase()} • {camera?.resolution} @ {camera?.fps}fps
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="text-sm text-success font-medium">LIVE</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Video panel */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-surface rounded-xl overflow-hidden">
            <div className="aspect-video bg-background relative flex items-center justify-center">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/3 to-accent/3" />
              {!camera ? (
                <Camera className="w-16 h-16 text-muted-foreground/20" />
              ) : processing ? (
                <canvas ref={canvasRef} className="w-full h-full" />
              ) : camera.type === "usb" || camera.type === "csi" ? (
                <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              ) : (
                <div className="p-6 text-center">
                  <Camera className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                  <div className="text-sm font-semibold">RTSP preview</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    RTSP can’t be played directly in the browser. Click <span className="font-semibold">Start AI Processing</span> to view frames via Universal.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            {!processing ? (
              <button
                onClick={startProcessing}
                disabled={Boolean(camera?.inferenceSessionId)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium glow-primary-sm transition-all ${
                  camera?.inferenceSessionId
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-gradient-atomic text-primary-foreground hover:scale-[1.02]"
                }`}
              >
                <Zap className="w-4 h-4" /> Start AI Processing
              </button>
            ) : (
              <button
                onClick={stopProcessing}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-destructive text-destructive-foreground font-medium hover:scale-[1.02] transition-all"
              >
                <Pause className="w-4 h-4" /> Stop Processing
              </button>
            )}
            <button className="p-2.5 rounded-lg border border-border hover:bg-muted transition-colors">
              <Square className="w-4 h-4" />
            </button>
            <button className="p-2.5 rounded-lg border border-border hover:bg-muted transition-colors">
              <ImageIcon className="w-4 h-4" />
            </button>
            <button className="p-2.5 rounded-lg border border-border hover:bg-muted transition-colors">
              <Circle className="w-4 h-4 text-destructive" />
            </button>
          </div>

          {/* Model Selection */}
          {modelPickerOpen ? (
            <ModelSelector selected={selectedModel} onSelect={setSelectedModel} models={models} />
          ) : (
            <button
              type="button"
              onClick={() => setModelPickerOpen(true)}
              className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              {selectedModelName ? `AI Model: ${selectedModelName}` : "Select AI Model"}
            </button>
          )}
        </div>

        {/* Right side info */}
        <div className="space-y-4">
          {(runError || runStatus) && (
            <div className="space-y-2">
              {runError && (
                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  {runError}
                </div>
              )}
              {runStatus && (
                <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
                  Status: <span className="font-mono text-foreground">{runStatus}</span>
                </div>
              )}
            </div>
          )}

          {processing && camera?.id ? <LiveStats connection={camera?.type.toUpperCase() || "—"} cameraId={camera.id} /> : null}
        </div>
      </div>
    </div>
  );
};

export default LiveViewScreen;
