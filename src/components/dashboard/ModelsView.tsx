import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Zap, Download, Camera, Wifi, Video, FolderOpen, Plus, X } from "lucide-react";
import { useModels } from "@/hooks/useModels";

type InputSource = "webcam" | "rtsp" | "video";
type Detection = { class_id?: number; class_name?: string; score?: number; box: [number, number, number, number] };

const ModelsView = () => {
  const [selected, setSelected] = useState<string | null>(null);
  const [inputSource, setInputSource] = useState<InputSource | null>(null);
  const [rtspUrl, setRtspUrl] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [query, setQuery] = useState("");
  const [runState, setRunState] = useState<"idle" | "starting" | "running">("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [lastLog, setLastLog] = useState<string | null>(null);
  const { models, loading, error } = useModels();
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameImgRef = useRef<HTMLImageElement | null>(null);
  const [frameStats, setFrameStats] = useState<{ fps?: number; inference_ms?: number; frame?: number } | null>(null);
  const pendingFrameRef = useRef<{ jpeg: string | null; dets: Detection[] } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRenderAtRef = useRef(0);
  const lastStatsAtRef = useRef(0);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const selectedModel = selected ? models.find((m) => m.id === selected) : undefined;

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Get folder name from first file's path
    const firstPath = (files[0] as any).webkitRelativePath as string;
    const folderName = firstPath.split('/')[0];

    // Validate: must have .nb and .so
    const hasNb = files.some(f => f.name.endsWith('.nb'));
    const hasSo = files.some(f => f.name.endsWith('.so'));
    if (!hasNb || !hasSo) {
      setUploadError(`"${folderName}" mein .nb aur .so dono files honi chahiye`);
      if (folderInputRef.current) folderInputRef.current.value = '';
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const fd = new FormData();
      for (const file of files) {
        // Encode folder name + filename together since FormData loses folder info
        const renamedFile = new File([file], `${folderName}__SEP__${file.name}`, { type: file.type });
        fd.append('files', renamedFile);
      }

      const res = await fetch('/universal/api/models/upload-folder', {
        method: 'POST',
        body: fd,
      });

      const data = await res.json() as { ok?: boolean; folderName?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Upload failed');

      setUploadSuccess(`✓ "${data.folderName}" model successfully loaded!`);
      setTimeout(() => setUploadSuccess(null), 4000);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
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

  const stopWs = () => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (!ws) return;
    try {
      ws.close();
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    return () => stopWs();
  }, []);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const scheduleRender = () => {
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

  const connectWsAndStart = async (sid: string) => {
    stopWs();
    setRunStatus("connecting");
    setLastLog(null);
    setFrameStats(null);
    pendingFrameRef.current = { jpeg: null, dets: [] };
    lastRenderAtRef.current = 0;
    lastStatsAtRef.current = 0;
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // Clear canvas immediately
    renderFrameToCanvas(null, []);

    const wsCandidates: string[] = [];
    {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      wsCandidates.push(`${proto}://${window.location.host}/universal`);
    }
    {
      const envBase = (import.meta as any).env?.VITE_UNIVERSAL_MODEL_DASHBOARD_URL as string | undefined;
      if (envBase && typeof envBase === "string") {
        try {
          const u = new URL(envBase);
          u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
          // WebSocket server is at the same HTTP server root.
          u.pathname = "/";
          u.search = "";
          u.hash = "";
          wsCandidates.push(u.toString().replace(/\/$/, ""));
        } catch {
          // ignore invalid URL
        }
      }
    }

    const connectAt = (i: number) => {
      const wsUrl = wsCandidates[i];
      if (!wsUrl) {
        setRunError(`WebSocket error talking to Universal dashboard (tried: ${wsCandidates.join(", ")})`);
        setRunState("idle");
        return;
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        setRunStatus("ws:open");
        ws.send(JSON.stringify({ type: "attach", sessionId: sid }));
        ws.send(JSON.stringify({ type: "start", sessionId: sid }));
      };

      ws.onmessage = (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }

        if (msg?.type === "status") {
          setRunStatus(msg.status ? String(msg.status) : "status");
        } else if (msg?.type === "log") {
          setLastLog(typeof msg.message === "string" ? msg.message : JSON.stringify(msg.message ?? msg));
        } else if (msg?.type === "inference") {
          const jpeg = typeof msg.jpeg === "string" ? (msg.jpeg as string) : null;
          const dets = Array.isArray(msg.detections) ? (msg.detections as Detection[]) : [];
          pendingFrameRef.current = { jpeg, dets };
          scheduleRender();

          // Throttle stats updates so React doesn't re-render at frame rate.
          const now = performance.now();
          if (now - lastStatsAtRef.current >= 500) {
            lastStatsAtRef.current = now;
            setFrameStats({ fps: msg.fps, inference_ms: msg.inference_ms, frame: msg.frame });
          }
        } else if (msg?.type === "error") {
          setRunError(typeof msg.message === "string" ? msg.message : "Universal inference error");
          setRunState("idle");
        }
      };

      ws.onerror = () => {
        if (!opened) {
          try {
            ws.close();
          } catch {
            // ignore
          }
          connectAt(i + 1);
          return;
        }
        setRunError("WebSocket error talking to Universal dashboard");
        setRunState("idle");
      };

      ws.onclose = () => {
        if (!opened) {
          connectAt(i + 1);
          return;
        }
        if (wsRef.current === ws) wsRef.current = null;
        setRunStatus("ws:closed");
      };
    };

    connectAt(0);
  };

  const startInference = async (source: InputSource) => {
    if (!selectedModel) return;
    // If something is already running, stop it first so the new model starts clean.
    if (sessionIdRef.current) {
      await stopInference();
    }
    setRunError(null);
    setRunState("starting");
    setSessionId(null);
    setRunStatus(null);
    setLastLog(null);

    try {
      let inputType: "webcam" | "rtsp" | "video";
      let inputValue: string;

      if (source === "webcam") {
        inputType = "webcam";
        inputValue = "usb:0";
      } else if (source === "rtsp") {
        inputType = "rtsp";
        inputValue = rtspUrl.trim();
        if (!inputValue) throw new Error("RTSP URL is required");
      } else {
        inputType = "video";
        if (!videoFile) throw new Error("Video file is required");

        const fd = new FormData();
        fd.append("file", videoFile);
        const uploadRes = await fetch("/universal/api/upload", { method: "POST", body: fd });
        if (!uploadRes.ok) throw new Error(`Upload failed (${uploadRes.status})`);
        const uploadData = (await uploadRes.json()) as { path?: string };
        if (!uploadData.path) throw new Error("Upload response missing file path");
        inputValue = uploadData.path;
      }

      const res = await fetch("/universal/api/inference/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelName: selectedModel.name,
          inputType,
          inputValue,
          objThresh: 0.25,
          nmsThresh: 0.45,
          logLevel: 0,
          // Lower JPEG quality reduces CPU (encode/decode) and bandwidth.
          jpegQuality: 60,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Inference start failed (${res.status})${text ? `: ${text}` : ""}`);
      }

      const data = (await res.json()) as { sessionId?: string; command?: string; error?: string };
      if (!data.sessionId) throw new Error(data.error || "Inference start response missing sessionId");

      setSessionId(data.sessionId);
      await connectWsAndStart(data.sessionId);
      setRunState("running");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start inference";
      setRunError(msg);
      setRunState("idle");
    }
  };

  const stopInference = async () => {
    const sid = sessionIdRef.current;
    // Ask Universal to stop immediately over WS (matches its UI behavior),
    // then close the socket and call REST stop as a fallback.
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && sid) {
      try {
        ws.send(JSON.stringify({ type: "stop", sessionId: sid }));
      } catch {
        // ignore
      }
    }
    stopWs();
    setRunState("idle");
    setRunStatus(null);
    setFrameStats(null);
    setSessionId(null);
    pendingFrameRef.current = { jpeg: null, dets: [] };
    lastRenderAtRef.current = 0;
    lastStatsAtRef.current = 0;
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    renderFrameToCanvas(null, []);

    if (!sid) return;
    try {
      await fetch(`/universal/api/inference/stop/${encodeURIComponent(sid)}`, { method: "POST" });
    } catch {
      // ignore
    }
  };

  const stats = useMemo(() => {
    const available = models.filter((m) => m.id !== "custom").length;
    const npuOptimized = models.filter((m) => m.id !== "custom" && m.npuOptimized).length;
    const activeDeployments = selected && selected !== "custom" ? 1 : 0;
    return { available, npuOptimized, activeDeployments };
  }, [selected]);

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => {
      const hay = `${m.id} ${m.name} ${(m.classes || []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [models, query]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-1">AI Models</h1>
          <p className="text-muted-foreground">Manage and deploy edge AI models</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={folderInputRef}
            type="file"
            // @ts-ignore
            webkitdirectory=""
            multiple
            className="hidden"
            onChange={handleFolderSelect}
          />
          <button
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-atomic text-primary-foreground text-sm font-medium glow-primary-sm hover:scale-[1.02] transition-all disabled:opacity-60 disabled:cursor-wait"
          >
            <Plus className="w-4 h-4" />
            {uploading ? "Uploading…" : "Add Models"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-surface rounded-xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{stats.available}</p>
            <p className="text-xs text-muted-foreground">Available Models</p>
          </div>
        </div>
        <div className="bg-surface rounded-xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Zap className="w-5 h-5 text-accent" />
          </div>
          <div>
            <p className="text-2xl font-bold">{stats.npuOptimized}</p>
            <p className="text-xs text-muted-foreground">NPU Optimized</p>
          </div>
        </div>
        <div className="bg-surface rounded-xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
            <Download className="w-5 h-5 text-success" />
          </div>
          <div>
            <p className="text-2xl font-bold">{stats.activeDeployments}</p>
            <p className="text-xs text-muted-foreground">Active Deployments</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {loading ? "Loading models from Universal Model Detection Dashboard…" : "Loaded from Universal Model Detection Dashboard"}
        </div>
        {error && <div className="text-xs text-destructive">{error}</div>}
      </div>
      {uploadError && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 flex items-center justify-between">
          <span>{uploadError}</span>
          <button onClick={() => setUploadError(null)} className="ml-2 hover:text-destructive/70"><X className="w-3 h-3" /></button>
        </div>
      )}
      {uploadSuccess && (
        <div className="text-xs text-success bg-success/10 border border-success/20 rounded-lg px-3 py-2">
          {uploadSuccess}
        </div>
      )}
      {runError && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
          {runError}
        </div>
      )}
      {sessionId && (
        <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
          Started inference session: <span className="font-mono text-foreground">{sessionId}</span>
        </div>
      )}
      {(runStatus || lastLog) && (
        <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2 space-y-1">
          {runStatus && (
            <div>
              Status: <span className="font-mono text-foreground">{runStatus}</span>
            </div>
          )}
          {lastLog && <div className="font-mono text-[11px] truncate">Log: {lastLog}</div>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Model list */}
        <div className="lg:col-span-5 xl:col-span-4">
          <div className="bg-surface rounded-xl overflow-hidden">
            <div className="p-5 border-b border-border">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">Models</div>
                  <div className="text-xs text-muted-foreground">Select a model to configure an input source.</div>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">{filteredModels.length} / {models.length}</div>
              </div>
              <div className="mt-4">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models…"
                  className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                />
              </div>
            </div>

            <div className="max-h-[520px] overflow-auto">
              {filteredModels.length > 0 ? (
                <div className="p-3 space-y-2">
                  {filteredModels.map((m) => {
                    const active = selected === m.id;
                    const subtitle = m.classes?.length ? `${m.classes.length} classes` : m.yaml ? "data.yaml detected" : "—";
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          void stopInference();
                          setSelected(m.id);
                          setInputSource(null);
                          setRtspUrl("");
                          setVideoFile(null);
                          setRunError(null);
                          setRunState("idle");
                        }}
                        className={`w-full p-4 rounded-xl border text-left transition-all duration-200 ${
                          active ? "border-primary bg-primary/10 glow-primary-sm" : "border-border bg-muted/30 hover:border-primary/30 hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <m.icon className={`w-5 h-5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                              <div className="font-semibold text-sm truncate">{m.name}</div>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground truncate">{m.id}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {m.npuOptimized && (
                              <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium bg-accent/10 text-accent border border-accent/20">
                                <Zap className="w-3 h-3" /> NPU
                              </span>
                            )}
                            <span className="inline-flex items-center rounded-full px-2 py-1 text-[10px] font-medium bg-muted border border-border text-muted-foreground">
                              {subtitle}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="p-6 text-sm text-muted-foreground">No models match your search.</div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Details */}
        <div className="lg:col-span-7 xl:col-span-8">
          <div className="bg-surface rounded-xl p-6">
            {!selectedModel ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-16">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                  <Brain className="w-6 h-6 text-primary" />
                </div>
                <div className="text-lg font-semibold">Select a model</div>
                <div className="text-sm text-muted-foreground mt-1 max-w-md">
                  Choose a model from the left list to view its folder and open an input source (Webcam, RTSP, or Video).
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <selectedModel.icon className="w-6 h-6 text-primary" />
                      <div className="text-xl font-bold truncate">{selectedModel.name}</div>
                      {selectedModel.npuOptimized && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium bg-accent/10 text-accent border border-accent/20">
                          <Zap className="w-3 h-3" /> NPU
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground break-all">{selectedModel.id}</div>
                  </div>
                </div>

                {/* Step 2: Input source */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-semibold">Input source</div>
                      <div className="text-xs text-muted-foreground">Pick where the frames come from.</div>
                    </div>
                    {inputSource ? (
                      <div className="text-xs text-muted-foreground">
                        Opened: <span className="font-medium text-foreground">{inputSource.toUpperCase()}</span>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">None selected</div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button
                      onClick={() => setInputSource("webcam")}
                      className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                        inputSource === "webcam"
                          ? "border-primary bg-primary/10 glow-primary-sm"
                          : "border-border bg-muted/30 hover:border-primary/30 hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Camera className="w-5 h-5 text-primary" />
                        <span className="font-semibold text-sm">Webcam</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Use browser camera.</p>
                    </button>

                    <button
                      onClick={() => setInputSource("rtsp")}
                      className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                        inputSource === "rtsp"
                          ? "border-primary bg-primary/10 glow-primary-sm"
                          : "border-border bg-muted/30 hover:border-primary/30 hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Wifi className="w-5 h-5 text-accent" />
                        <span className="font-semibold text-sm">RTSP</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Stream URL.</p>
                    </button>

                    <button
                      onClick={() => setInputSource("video")}
                      className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                        inputSource === "video"
                          ? "border-primary bg-primary/10 glow-primary-sm"
                          : "border-border bg-muted/30 hover:border-primary/30 hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Video className="w-5 h-5 text-success" />
                        <span className="font-semibold text-sm">Video</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Upload a file.</p>
                    </button>
                  </div>

                  {/* Live preview */}
                  <div className="mt-4 rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold">Detection Preview</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {frameStats?.fps ? `${frameStats.fps.toFixed(1)} FPS` : "-- FPS"} •{" "}
                        {typeof frameStats?.inference_ms === "number" ? `${frameStats.inference_ms.toFixed(1)} ms` : "-- ms"}
                      </div>
                    </div>
                    <div className="bg-muted/30 flex items-center justify-center">
                      <canvas ref={canvasRef} className="max-h-[420px] w-full" />
                    </div>
                    {runState !== "running" && (
                      <div className="p-4 text-xs text-muted-foreground">
                        Start a session to see frames here (Universal sends frames via WebSocket as base64 JPEG).
                      </div>
                    )}
                  </div>

                  {/* Opened panel */}
                  <div className="mt-4 rounded-xl border border-border bg-muted/20 p-4">
                    {!inputSource ? (
                      <div className="text-sm text-muted-foreground">Select an input source above to show its settings.</div>
                    ) : inputSource === "webcam" ? (
                      <div key="webcam" className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold">Webcam is opened</div>
                          <div className="text-xs text-muted-foreground mt-1">We’ll start the Universal dashboard inference next.</div>
                        </div>
                        <button
                          onClick={() => startInference("webcam")}
                          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
                            runState === "starting"
                              ? "bg-muted text-muted-foreground cursor-wait"
                              : "bg-primary text-primary-foreground hover:scale-[1.01] transition-transform"
                          }`}
                          disabled={runState === "starting"}
                        >
                          {runState === "starting" ? "Starting…" : runState === "running" ? "Running" : "Start"}
                        </button>
                        {runState === "running" && (
                          <button
                            onClick={stopInference}
                            className="px-4 py-2 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted transition-colors"
                          >
                            Stop
                          </button>
                        )}
                      </div>
                    ) : inputSource === "rtsp" ? (
                      <div key="rtsp" className="space-y-3">
                        <div className="text-sm font-semibold">RTSP is opened</div>
                        <div>
                          <label className="block text-xs font-medium text-secondary-foreground mb-2">RTSP URL</label>
                          <input
                            value={rtspUrl}
                            onChange={(e) => setRtspUrl(e.target.value)}
                            placeholder="rtsp://username:password@ip:554/stream"
                            className="w-full px-4 py-3 rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                          />
                        </div>
                        <button
                          onClick={() => startInference("rtsp")}
                          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
                            rtspUrl.trim() && runState !== "starting"
                              ? "bg-primary text-primary-foreground hover:scale-[1.01] transition-transform"
                              : "bg-muted text-muted-foreground cursor-not-allowed"
                          }`}
                          disabled={!rtspUrl.trim() || runState === "starting"}
                        >
                          {runState === "starting" ? "Starting…" : runState === "running" ? "Running" : "Start"}
                        </button>
                        {runState === "running" && (
                          <button
                            onClick={stopInference}
                            className="px-4 py-2 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted transition-colors"
                          >
                            Stop
                          </button>
                        )}
                      </div>
                    ) : (
                      <div key="video" className="space-y-3">
                        <div className="text-sm font-semibold">Video upload is opened</div>
                        <div>
                          <label className="block text-xs font-medium text-secondary-foreground mb-2">Video file</label>
                          <input
                            type="file"
                            accept="video/*"
                            onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
                            className="w-full text-sm"
                          />
                          {videoFile && <div className="mt-2 text-xs text-muted-foreground">Selected: {videoFile.name}</div>}
                        </div>
                        <button
                          onClick={() => startInference("video")}
                          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
                            videoFile && runState !== "starting"
                              ? "bg-primary text-primary-foreground hover:scale-[1.01] transition-transform"
                              : "bg-muted text-muted-foreground cursor-not-allowed"
                          }`}
                          disabled={!videoFile || runState === "starting"}
                        >
                          {runState === "starting" ? "Uploading…" : runState === "running" ? "Running" : "Upload & Start"}
                        </button>
                        {runState === "running" && (
                          <button
                            onClick={stopInference}
                            className="px-4 py-2 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted transition-colors"
                          >
                            Stop
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    
    </div>
  );
};

export default ModelsView;
