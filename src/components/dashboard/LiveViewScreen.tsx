import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Square, ImageIcon, Circle, Play, Pause, Zap, PencilLine } from "lucide-react";
import type { CameraConfig } from "@/pages/Dashboard";
import { useWorkspaceModels } from "@/hooks/useWorkspaceModels";
import { Button } from "@/components/ui/button";
import ModelSelector from "./ModelSelector";
import LiveStats from "./LiveStats";
import { RenameCameraDialog } from "@/components/dashboard/RenameCameraDialog";
import { createInferenceEventSink } from "@/services/inferenceEventPipeline";
import { inferenceApiBase, inferenceBackendForCamera } from "@/lib/inferenceBackend";
import { sessionsApiForCamera } from "@/services/inferenceSessionReconcile";
import { subscribeUniversalSession } from "@/services/universalSessionWs";
import {
  faceSessionIdForCamera,
  faceWhepUrl,
  isFaceInferenceSession,
  registerFaceStreamCamera,
  unregisterFaceStreamCamera,
} from "@/services/faceLiveStream";
import { connectFaceWhep, type FaceWhepConnection } from "@/services/faceWhepPlayer";

interface Props {
  camera: CameraConfig | null;
  onBack: () => void;
  onUpdateCamera: (cameraId: string, patch: Partial<CameraConfig>) => void;
}

const LiveViewScreen = ({ camera, onBack, onUpdateCamera }: Props) => {
  const [processing, setProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const workspaceId = camera?.detectionWorkspace ?? "cameras";
  const isFaceWorkspace = workspaceId === "cameras3";
  const inferenceBackend = inferenceBackendForCamera(camera);
  const { models } = useWorkspaceModels(workspaceId);
  const [runError, setRunError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const unsubscribeWsRef = useRef<null | (() => void)>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameImgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pendingFrameRef = useRef<{ jpeg: string | null; dets: Detection[] } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRenderAtRef = useRef(0);
  const eventSinkRef = useRef<ReturnType<typeof createInferenceEventSink> | null>(null);
  const lastInferenceLogRef = useRef<string | null>(null);
  const autoStartAttemptedRef = useRef(false);
  const whepRef = useRef<FaceWhepConnection | null>(null);

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

  const stopWhep = () => {
    try {
      whepRef.current?.close();
    } catch {
      /* ignore */
    }
    whepRef.current = null;
  };

  const clearStaleInferenceSession = () => {
    if (!camera?.id) return;
    stopWs();
    stopWhep();
    setProcessing(false);
    setSessionId(null);
    setRunStatus(null);
    onUpdateCamera(camera.id, {
      inferenceSessionId: undefined,
      inferenceStartedAt: undefined,
    });
  };

  const connectFaceWhepStream = async () => {
    if (!camera?.id) throw new Error("No camera");
    if (!videoRef.current) throw new Error("Video element not ready");
    stopWhep();
    whepRef.current = await connectFaceWhep(faceWhepUrl(camera.id), videoRef.current);
  };

  const startFaceProcessing = async () => {
    if (!camera) return;
    setRunError(null);
    setRunStatus("Starting face recognition…");
    try {
      await registerFaceStreamCamera(camera);
      await waitMs(2000);
      await connectFaceWhepStream();
      const sid = faceSessionIdForCamera(camera.id);
      setSessionId(sid);
      setProcessing(true);
      setRunStatus("Face recognition active — events appear in Face recognition tab");
      onUpdateCamera(camera.id, {
        model: "Face recognition",
        inferenceBackend: "face",
        inferenceSessionId: sid,
        inferenceStartedAt: Date.now(),
        inferenceModelId: undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start face recognition";
      setRunError(msg);
      setProcessing(false);
      stopWhep();
      void unregisterFaceStreamCamera(camera.id);
    }
  };

  const stopFaceProcessing = async () => {
    stopWhep();
    stopWebcam();
    setProcessing(false);
    setRunStatus(null);
    setSessionId(null);
    if (camera?.id) {
      onUpdateCamera(camera.id, {
        inferenceSessionId: undefined,
        inferenceStartedAt: undefined,
      });
      await unregisterFaceStreamCamera(camera.id);
    }
  };

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

  const stopExistingInferenceSession = async (sid: string | undefined, backend = inferenceBackend) => {
    if (!sid) return;
    try {
      await fetch(`${inferenceApiBase(backend)}/api/inference/stop/${encodeURIComponent(sid)}`, {
        method: "POST",
      });
    } catch {
      // ignore
    }
  };

  const connectWsAttach = (sid: string) => {
    stopWs();
    eventSinkRef.current = camera ? createInferenceEventSink(camera, sid) : null;
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
          if (!status) return;
          setRunStatus(status);
          if (status === "stopped" || status.startsWith("stopped")) {
            setProcessing(false);
          } else if (
            status === "running" ||
            status.startsWith("attached") ||
            status.startsWith("ws:open")
          ) {
            setProcessing(true);
          }
        },
        onError: (err) => {
          setRunError(err);
          setProcessing(false);
          if (/session|expired|not found|unknown/i.test(err)) {
            clearStaleInferenceSession();
          }
        },
        onMessage: (msg) => {
          // Surface backend errors from detect.py (e.g. "Cannot open: usb:0"
          // when the V4L2 device is busy or missing). Without this the UI just
          // sits silently on "connecting…" and the user sees the camera LED
          // blink once and nothing happens.
          if (msg?.type === "status" && msg.status === "stopped") {
            const code = typeof msg.exitCode === "number" ? msg.exitCode : null;
            setProcessing(false);
            const detail = lastInferenceLogRef.current?.trim();
            setRunError(
              code != null
                ? detail
                  ? `AI process exited (code ${code}): ${detail}`
                  : `AI process exited (code ${code}). Close other apps using the camera and ensure asnn-dashboard/models/<name>/ has .nb and .so files.`
                : detail || "AI process stopped. Select a model or click Start AI Processing to try again.",
            );
            return;
          }
          if (msg?.type === "log") {
            const level = String(msg.level || "").toLowerCase();
            const text = typeof msg.message === "string" ? msg.message : "";
            if (text && /simulation mode/i.test(text)) {
              setRunError("Fake detection mode is disabled. Install detect.py and model .nb/.so on the device.");
              setProcessing(false);
              return;
            }
            if (text && (level === "err" || level === "error" || level === "stderr")) {
              lastInferenceLogRef.current = text;
              setRunError(text);
              setProcessing(false);
            } else if (text && level === "warn") {
              if (/asnn not found/i.test(text)) {
                setRunError(
                  "ASNN runtime not found — install the NPU stack on the board or use a model with valid .nb/.so files.",
                );
              } else {
                setRunStatus(text);
              }
            }
            return;
          }
          if (msg?.type !== "inference") return;
          if (msg.simulated === true) {
            setRunError("Simulation stream is not used. Stop and start processing again with a real model.");
            return;
          }
          const jpeg = typeof msg.jpeg === "string" ? msg.jpeg : null;
          const dets = Array.isArray(msg.detections) ? (msg.detections as Detection[]) : [];
          if (jpeg) eventSinkRef.current?.ingestInferenceFrame(jpeg, dets, { simulated: false });
          pendingFrameRef.current = { jpeg, dets };
          scheduleRender();
        },
      },
      { lingerMs: 15000, autoStart: true, backend: inferenceBackend },
    );
  };

  const startProcessing = async (modelIdOverride?: string) => {
    if (!camera) return;
    if (isFaceWorkspace) {
      await startFaceProcessing();
      return;
    }
    const modelId = modelIdOverride ?? selectedModel;
    const model = modelId ? models.find((m) => m.id === modelId) : null;
    if (!model) {
      setRunError("Select an AI model to start detection");
      setModelPickerOpen(true);
      return;
    }
    if (modelIdOverride) setSelectedModel(modelIdOverride);

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
        await waitMs(1000);
      }

      if (camera.inferenceSessionId) {
        await stopExistingInferenceSession(camera.inferenceSessionId);
        onUpdateCamera(camera.id, {
          inferenceSessionId: undefined,
          inferenceStartedAt: undefined,
        });
        await waitMs(300);
      }

      const res = await fetch(`${inferenceApiBase(inferenceBackend)}/api/inference/start`, {
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
      const data = (await res.json().catch(() => ({}))) as {
        sessionId?: string;
        error?: string;
        hint?: string;
      };
      if (!res.ok) {
        const hint = typeof data.hint === "string" ? data.hint : "";
        throw new Error(data.error ? `${data.error}${hint ? ` ${hint}` : ""}` : `Inference start failed (${res.status})`);
      }
      if (!data.sessionId) throw new Error(data.error || "Inference start missing sessionId");
      setSessionId(data.sessionId);
      setProcessing(true);
      connectWsAttach(data.sessionId);
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
    if (isFaceWorkspace) {
      await stopFaceProcessing();
      return;
    }
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
        inferenceStartedAt: undefined,
      });
    }

    if (!sid) return;
    try {
      await fetch(`${inferenceApiBase(inferenceBackend)}/api/inference/stop/${encodeURIComponent(sid)}`, {
        method: "POST",
      });
    } catch {
      // ignore
    }
  };

  const handleModelSelect = (modelId: string) => {
    setModelPickerOpen(false);
    lastInferenceLogRef.current = null;
    if (camera && (camera.type === "usb" || camera.type === "csi")) {
      stopWebcam();
    }
    void startProcessing(modelId);
  };

  useEffect(() => {
    const saved = camera?.inferenceModelId ?? null;
    setSelectedModel(saved);
    setModelPickerOpen(!isFaceWorkspace && !saved && !camera?.inferenceSessionId);
    setRunError(null);
    setRunStatus(null);
    lastInferenceLogRef.current = null;
    autoStartAttemptedRef.current = false;
    setSessionId(camera?.inferenceSessionId ?? null);
    setProcessing(Boolean(camera?.inferenceSessionId));
    setRenameOpen(false);
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

  const selectedModelName = selectedModel
    ? models.find((m) => m.id === selectedModel)?.name ?? null
    : null;

  // Face workspace: auto-start stream when opening Live View after add-camera.
  useEffect(() => {
    if (!isFaceWorkspace || !camera) return;
    if (camera.inferenceSessionId || processing) return;
    if (autoStartAttemptedRef.current) return;
    autoStartAttemptedRef.current = true;
    void startFaceProcessing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera?.id, camera?.inferenceSessionId, isFaceWorkspace, processing]);

  // After add-camera with a pre-selected model, start detection once models are loaded.
  useEffect(() => {
    if (isFaceWorkspace) return;
    if (!camera?.inferenceModelId || camera.inferenceSessionId || processing) return;
    if (autoStartAttemptedRef.current) return;
    const model = models.find((m) => m.id === camera.inferenceModelId);
    if (!model) return;
    autoStartAttemptedRef.current = true;
    void startProcessing(camera.inferenceModelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera?.id, camera?.inferenceModelId, camera?.inferenceSessionId, models, processing, isFaceWorkspace]);

  useEffect(() => {
    const sid = camera?.inferenceSessionId;
    if (!sid || !camera?.id) return;

    if (isFaceInferenceSession(sid)) {
      let cancelled = false;
      setProcessing(true);
      setSessionId(sid);
      const tryResume = async (attempt: number) => {
        if (cancelled) return;
        if (!videoRef.current) {
          if (attempt > 40) {
            setRunError("Video preview did not mount.");
            return;
          }
          requestAnimationFrame(() => void tryResume(attempt + 1));
          return;
        }
        try {
          await connectFaceWhepStream();
          setRunError(null);
          setRunStatus("Face recognition active");
        } catch (e) {
          if (!cancelled) {
            setRunError(e instanceof Error ? e.message : "Face stream connect failed");
            clearStaleInferenceSession();
          }
        }
      };
      void tryResume(0);
      return () => {
        cancelled = true;
        stopWhep();
      };
    }

    let cancelled = false;
    void fetch(sessionsApiForCamera(camera))
      .then(async (r) => {
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as {
          sessions?: Array<{ id: string; simulated?: boolean; running?: boolean; status?: string }>;
        };
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        if (cancelled) return;
        const match = sessions.find((s) => s?.id === sid);
        if (!match) {
          // auth-server restarted or session ended — drop stale id, no error banner
          clearStaleInferenceSession();
          return;
        }
        const status = String(match.status || "").toLowerCase();
        const canResume =
          !match.simulated &&
          status !== "error" &&
          status !== "stopped" &&
          // "ready" = waiting for WebSocket attach (running is false until then)
          (match.running === true || status === "ready" || status === "running" || status === "pending");
        if (canResume) {
          setRunError(null);
          setProcessing(true);
          setSessionId(sid);
          connectWsAttach(sid);
          return;
        }
        clearStaleInferenceSession();
        setRunError("Previous AI session ended. Click Start AI Processing to run again.");
      })
      .catch(() => {
        if (!cancelled) connectWsAttach(sid);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera?.id, camera?.inferenceSessionId, isFaceWorkspace]);

  useEffect(() => {
    if (!camera) return;
    if (processing) return;
    if (isFaceWorkspace) return;
    // Skip browser preview when a model is chosen — backend will open the device.
    if (camera.inferenceModelId) return;
    if (camera.type !== "usb" && camera.type !== "csi") return;

    let cancelled = false;
    let raf = 0;
    const tryPreview = (attempt: number) => {
      if (cancelled) return;
      if (videoRef.current) {
        void startWebcamPreview();
        return;
      }
      if (attempt > 40) {
        setRunError("Camera preview did not mount. Try going back and opening Live View again.");
        return;
      }
      raf = requestAnimationFrame(() => tryPreview(attempt + 1));
    };
    tryPreview(0);

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      stopWebcam();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera?.id, camera?.type, processing]);

  useEffect(() => {
    return () => {
      stopWs();
      stopWhep();
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
      <div className="flex items-start gap-3 sm:items-center">
        <button type="button" onClick={onBack} className="mt-0.5 shrink-0 rounded-lg p-2 transition-colors hover:bg-muted sm:mt-0">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{camera?.name || "Live View"}</h1>
            {camera ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs font-medium"
                onClick={() => setRenameOpen(true)}
              >
                <PencilLine className="h-3.5 w-3.5" aria-hidden />
                Rename
              </Button>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {camera
              ? `${camera.type.toUpperCase()} • ${camera.resolution} @ ${camera.fps}fps`
              : "Choose a camera from the dashboard to begin."}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 self-start sm:self-center">
          <div className="h-2 w-2 animate-pulse rounded-full bg-success" />
          <span className="text-sm font-medium text-success">LIVE</span>
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
              ) : processing && isFaceWorkspace ? (
                <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
              ) : processing ? (
                <canvas ref={canvasRef} className="w-full h-full" />
              ) : camera.type === "usb" || camera.type === "csi" ? (
                <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              ) : (
                <div className="p-6 text-center">
                  <Camera className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                  <div className="text-sm font-semibold">RTSP preview</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    RTSP can’t be played directly in the browser. Select an AI model below to start the detection stream.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            {!processing ? (
              <button
                onClick={() => void startProcessing()}
                disabled={!isFaceWorkspace && !selectedModel}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all ${
                  isFaceWorkspace || selectedModel
                    ? "glow-primary-sm bg-gradient-atomic text-primary-foreground hover:scale-[1.02]"
                    : "cursor-not-allowed bg-muted text-muted-foreground"
                }`}
              >
                <Zap className="w-4 h-4" /> {isFaceWorkspace ? "Start face stream" : "Start AI Processing"}
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

          {/* Model Selection — ASNN workspaces only */}
          {!isFaceWorkspace &&
            (modelPickerOpen || !selectedModel ? (
              <ModelSelector selected={selectedModel} onSelect={handleModelSelect} models={models} />
            ) : (
              <button
                type="button"
                onClick={() => setModelPickerOpen(true)}
                className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                {selectedModelName ? `AI Model: ${selectedModelName} (change)` : "Select AI Model"}
              </button>
            ))}
          {isFaceWorkspace ? (
            <p className="text-xs text-muted-foreground">
              Uses the <span className="font-mono">live_stream</span> face model (YOLO11n-face + MobileFaceNet).
              Known and Unknown detections are saved under Face recognition.
            </p>
          ) : null}
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

      <RenameCameraDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        camera={camera}
        onSave={(id, name) => onUpdateCamera(id, { name })}
      />
    </div>
  );
};

export default LiveViewScreen;
