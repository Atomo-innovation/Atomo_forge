import { useEffect, useRef, useState } from "react";
import { subscribeUniversalSession } from "@/services/universalSessionWs";

type Detection = { box: [number, number, number, number] };

export default function CameraTileStream({
  sessionId,
  onInvalidSession,
}: {
  sessionId: string | undefined;
  onInvalidSession?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRenderAtRef = useRef(0);
  const pendingRef = useRef<{ jpeg: string; dets: Detection[] } | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "streaming" | "error">("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  useEffect(() => {
    if (!sessionId) {
      setStatus("idle");
      return;
    }

    // Quick sanity check: if Universal doesn't know this session, clear it so UI can restart cleanly.
    fetch("/universal/api/inference/sessions")
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as { sessions?: Array<{ id: string }> };
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        const ok = sessions.some((s) => s?.id === sessionId);
        if (!ok) {
          setStatus("error");
          setErrorText("Session expired — start again");
          onInvalidSession?.();
        }
      })
      .catch(() => {
        // ignore; WS may still work in some deployments
      });

    setStatus("connecting");
    setErrorText(null);

    const renderNow = () => {
      rafRef.current = null;
      const p = pendingRef.current;
      if (!p) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      let img = imgRef.current;
      if (!img) {
        img = new Image();
        imgRef.current = img;
      }

      const { jpeg, dets } = p;
      img.onload = () => {
        if (canvas.width !== img!.naturalWidth || canvas.height !== img!.naturalHeight) {
          canvas.width = img!.naturalWidth;
          canvas.height = img!.naturalHeight;
        }
        ctx.drawImage(img!, 0, 0);

        ctx.save();
        ctx.strokeStyle = "rgba(59,130,246,0.85)";
        ctx.lineWidth = 2;
        for (const d of dets) {
          const [x1n, y1n, x2n, y2n] = d.box;
          ctx.strokeRect(
            x1n * canvas.width,
            y1n * canvas.height,
            (x2n - x1n) * canvas.width,
            (y2n - y1n) * canvas.height,
          );
        }
        ctx.restore();
      };
      img.src = `data:image/jpeg;base64,${jpeg}`;

      setStatus((s) => (s === "streaming" ? s : "streaming"));
    };

    const scheduleRender = () => {
      // Cap tile rendering to reduce CPU while keeping UI identical.
      // (Universal may send frames faster than the browser can decode/draw.)
      const MAX_FPS = 12;
      const minDt = 1000 / MAX_FPS;
      const now = performance.now();
      const dt = now - lastRenderAtRef.current;
      if (dt < minDt) return;
      lastRenderAtRef.current = now;
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(renderNow);
    };

    const unsub = subscribeUniversalSession(
      sessionId,
      {
        onStatus: ({ connected }) => {
          setStatus((cur) => {
            const next = connected ? "streaming" : "connecting";
            return cur === next ? cur : next;
          });
        },
        onError: (err) => {
          setStatus("error");
          setErrorText(err);
        },
        onMessage: (msg) => {
          if (msg?.type !== "inference") return;
          if (typeof msg.jpeg !== "string") return;

          pendingRef.current = {
            jpeg: msg.jpeg,
            dets: Array.isArray(msg.detections) ? (msg.detections as Detection[]) : [],
          };
          scheduleRender();
        },
      },
      // Camera tiles should only attach to already-running sessions.
      { lingerMs: 12000, autoStart: false },
    );

    return () => {
      unsub();
      pendingRef.current = null;
      lastRenderAtRef.current = 0;
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [sessionId]);

  if (!sessionId) return null;

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="w-full h-full object-cover" />
      {status === "connecting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 text-xs text-muted-foreground gap-1 px-3 text-center">
          <div>Connecting…</div>
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 text-xs text-destructive gap-1 px-3 text-center">
          <div>{errorText || "Stream error"}</div>
          <div className="font-mono text-[10px] opacity-80">sid: {sessionId}</div>
        </div>
      )}
    </div>
  );
}

