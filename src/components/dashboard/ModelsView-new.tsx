import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Zap, Download, Camera, Wifi, Video, Plus, X } from "lucide-react";
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

    const firstPath = (files[0] as any).webkitRelativePath as string;
    const folderName = firstPath.split('/')[0];

    const hasNb = files.some(f => f.name.endsWith('.nb'));
    const hasSo = files.some(f => f.name.endsWith('.so'));
    if (!hasNb || !hasSo) {
      setUploadError(`"${folderName}" need both .nb and .so files.`);
      if (folderInputRef.current) folderInputRef.current.value = '';
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const fd = new FormData();
      for (const file of files) {
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
    <div className="h-screen flex flex-col bg-background animate-fade-in">
      {/* Header */}
      <div className="border-b border-border/60 bg-card/50 backdrop-blur-sm sticky top-0 z-10 px-6 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">AI Models</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage and deploy edge AI models with real-time inference</p>
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
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-atomic text-primary-foreground text-sm font-medium glow-primary-sm hover:scale-[1.02] transition-all disabled:opacity-60 disabled:cursor-wait whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              {uploading ? "Uploading…" : "Add Models"}
            </button>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="border-b border-border/60 bg-muted/20 px-6 py-3">
        <div className="max-w-[1600px] mx-auto">
          <div className="grid grid-cols-3 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Brain className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Available Models</p>
                <p className="text-lg font-bold tabular-nums">{stats.available}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">NPU Optimized</p>
                <p className="text-lg font-bold tabular-nums">{stats.npuOptimized}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
                <Download className="w-4 h-4 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Active Deployments</p>
                <p className="text-lg font-bold tabular-nums">{stats.activeDeployments}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Alerts */}
      <div className="px-6 py-3 space-y-2 max-w-[1600px] mx-auto w-full">
        {loading && (
          <div className="text-xs text-muted-foreground bg-muted/30 border border-border/40 rounded-lg px-3 py-2 flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
            Loading models…
          </div>
        )}
        {error && <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">{error}</div>}
        {uploadError && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 flex items-center justify-between">
            <span>{uploadError}</span>
            <button onClick={() => setUploadError(null)} className="ml-2 hover:text-destructive/70"><X className="w-3 h-3" /></button>
          </div>
        )}
        {uploadSuccess && (
          <div className="text-xs text-success bg-success/10 border border-success/30 rounded-lg px-3 py-2 flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-success rounded-full" />
            {uploadSuccess}
          </div>
        )}
        {runError && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">{runError}</div>
        )}
        {sessionId && (
          <div className="text-xs text-success bg-success/10 border border-success/30 rounded-lg px-3 py-2 flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />
            Session active: <span className="font-mono text-foreground">{sessionId}</span>
          </div>
        )}
        {(runStatus || lastLog) && (
          <div className="text-xs text-muted-foreground bg-muted/30 border border-border/40 rounded-lg px-3 py-2 space-y-1">
            {runStatus && <div>Status: <span className="font-mono text-foreground">{runStatus}</span></div>}
            {lastLog && <div className="font-mono text-[11px] truncate">Log: {lastLog}</div>}
          </div>
        )}
      </div>

      {/* Main Layout */}
      <div className="flex-1 min-h-0 px-6 py-4 overflow-auto">
        <div className="max-w-[1600px] mx-auto h-full">
          <div className="grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-6 h-full">
            {/* Left: Model List */}
            <div className="flex flex-col min-h-0 bg-surface rounded-xl border border-border overflow-hidden">
              <div className="p-4 border-b border-border bg-muted/30">
                <div className="text-sm font-semibold mb-3">Models</div>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <div className="text-xs text-muted-foreground mt-2">{filteredModels.length} / {models.length}</div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto">
                {filteredModels.length > 0 ? (
                  <div className="p-3 space-y-2">
                    {filteredModels.map((m) => {
                      const active = selected === m.id;
                      const subtitle = m.classes?.length ? `${m.classes.length} classes` : m.yaml ? "data.yaml" : "—";
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
                          className={`w-full p-3 rounded-lg border text-left transition-all text-sm ${
                            active ? "border-primary bg-primary/15 glow-primary-sm" : "border-border bg-muted/40 hover:border-primary/40 hover:bg-muted/60"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <m.icon className={`w-4 h-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
                                <div className="font-semibold truncate">{m.name}</div>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground truncate">{m.id}</div>
                            </div>
                            {m.npuOptimized && (
                              <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-semibold bg-accent/20 text-accent shrink-0">
                                <Zap className="w-2.5 h-2.5" /> NPU
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-1.5">{subtitle}</div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-6 text-center text-sm text-muted-foreground">No models match</div>
                )}
              </div>
            </div>

            {/* Right: Canvas + Controls */}
            <div className="flex flex-col gap-4 min-h-0">
              {/* Canvas */}
              <div className="flex-[2] bg-surface rounded-xl border border-border overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                  <div className="text-sm font-semibold">Detection Preview</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {frameStats?.fps ? `${frameStats.fps.toFixed(1)} FPS` : "—"} • {typeof frameStats?.inference_ms === "number" ? `${frameStats.inference_ms.toFixed(1)}ms` : "—"}
                  </div>
                </div>
                <div className="flex-1 min-h-0 bg-muted/20 flex items-center justify-center">
                  {!selectedModel ? (
                    <div className="text-center text-muted-foreground">
                      <Brain className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">Select a model</p>
                    </div>
                  ) : (
                    <canvas ref={canvasRef} className="max-w-full max-h-full" />
                  )}
                </div>
              </div>

              {/* Controls */}
              <div className="flex-1 bg-surface rounded-xl border border-border p-4 overflow-y-auto">
                {!selectedModel ? (
                  <div className="text-center text-muted-foreground text-sm">Select a model</div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm font-semibold mb-2">Input Source</div>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: "webcam", label: "Webcam", icon: Camera },
                          { id: "rtsp", label: "RTSP", icon: Wifi },
                          { id: "video", label: "Video", icon: Video },
                        ].map(({ id, label, icon: Icon }) => (
                          <button
                            key={id}
                            onClick={() => setInputSource(id as InputSource)}
                            className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                              inputSource === id
                                ? "border-primary bg-primary/15 text-foreground"
                                : "border-border bg-muted/40 text-muted-foreground hover:border-primary/40"
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5 mx-auto mb-1" />
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {inputSource === "rtsp" && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">RTSP URL</label>
                        <input
                          value={rtspUrl}
                          onChange={(e) => setRtspUrl(e.target.value)}
                          placeholder="rtsp://user:pass@ip:554/stream"
                          className="w-full px-3 py-2 rounded-lg bg-muted border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>
                    )}

                    {inputSource === "video" && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Video File</label>
                        <input
                          type="file"
                          accept="video/*"
                          onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
                          className="w-full text-xs"
                        />
                        {videoFile && <div className="mt-1 text-xs text-success">✓ {videoFile.name}</div>}
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => startInference(inputSource || "webcam")}
                        disabled={runState === "starting" || (inputSource === "rtsp" && !rtspUrl.trim()) || (inputSource === "video" && !videoFile) || !inputSource}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                          runState !== "running" && ((inputSource && (inputSource === "webcam" || (inputSource === "rtsp" && rtspUrl.trim()) || (inputSource === "video" && videoFile))) || false)
                            ? "bg-primary text-primary-foreground hover:scale-[1.01]"
                            : "bg-muted text-muted-foreground cursor-not-allowed"
                        }`}
                      >
                        {runState === "starting" ? "Starting…" : runState === "running" ? "Running" : "Start"}
                      </button>
                      {runState === "running" && (
                        <button
                          onClick={stopInference}
                          className="px-3 py-2 rounded-lg border border-destructive bg-destructive/10 text-destructive text-sm font-semibold hover:bg-destructive/20"
                        >
                          Stop
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelsView;
