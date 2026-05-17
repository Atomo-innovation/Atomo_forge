import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Embeds the PDEU digital twin (three.js). Path is resolved by scripts/resolve-pdeu-digital-twin-dir.cjs
 * (prefer final_ prefix trees under the repo root, not a stale repo-root pdeu_digitaltwin folder).
 * Vite proxies /pdeu-twin/ to the twin HTTP server (TWIN_HTTP_PORT) with WS support.
 */
const TwinView = () => {
  const [iframeKey, setIframeKey] = useState(0);
  const [proxyOk, setProxyOk] = useState<boolean | null>(null);
  const [iframeBusy, setIframeBusy] = useState(true);

  const twinUrl = useMemo(() => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return `${base}/pdeu-twin/`;
  }, []);

  useEffect(() => {
    setIframeBusy(true);
  }, [iframeKey]);

  useEffect(() => {
    let cancelled = false;
    setProxyOk(null);

    async function probe() {
      /** Twin may boot after slow `npm install` in [twin] or via Vite’s auto-start; avoid flashing a false alarm. */
      const maxAttempts = 90;
      for (let i = 0; i < maxAttempts; i++) {
        if (cancelled) return;
        try {
          const r = await fetch("/pdeu-twin/", {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
          });
          // `fetch.ok` excludes 304; proxy/CDN sometimes returns cached 304 → treat as reachable.
          if (!cancelled && r.status >= 200 && r.status < 400) {
            setProxyOk(true);
            return;
          }
        } catch {
          /* proxy not ready yet */
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!cancelled) setProxyOk(false);
    }

    void probe();
    return () => {
      cancelled = true;
    };
  }, [iframeKey]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-2">
      {proxyOk === false && (
        <Alert variant="destructive">
          <AlertTitle>Digital twin server not reachable</AlertTitle>
          <AlertDescription className="text-sm space-y-2">
            <p>
              The app proxies <span className="font-mono">/pdeu-twin</span> to the twin HTTP server on{" "}
              <span className="font-mono">127.0.0.1:{import.meta.env.VITE_FORGE_TWIN_PROXY_PORT}</span>{" "}
              (set{" "}
              <span className="font-mono">TWIN_HTTP_PORT</span> in <span className="font-mono">.env</span> if needed — same
              for Vite and the twin). In the terminal, confirm{" "}
              <span className="font-mono">[twin]</span> printed{" "}
              <span className="font-mono">DIGITAL TWIN SERVER STARTED</span> and restart{" "}
              <code className="rounded bg-muted px-1">npm run dev</code>.
            </p>
            <p>
              Install twin dependencies from the repo root:{" "}
              <code className="rounded bg-muted px-1">npm run twin:install</code> (also runs automatically after{" "}
              <code className="rounded bg-muted px-1">npm install</code> via <span className="font-mono">postinstall</span>
              ).
            </p>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-1">
        <Button type="button" variant="outline" size="sm" onClick={() => setIframeKey((k) => k + 1)}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Reload twin
        </Button>
        <Button type="button" variant="outline" size="sm" asChild>
          <a href={twinUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-1" />
            Open in tab
          </a>
        </Button>
      </div>
      <div className="relative flex min-h-0 flex-1 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-black">
        {iframeBusy && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/90 backdrop-blur-[1px]">
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Loading digital twin…</p>
            <p className="max-w-md px-4 text-center text-xs text-muted-foreground">
              First load pulls Three.js from <span className="font-mono">node_modules</span> through the dev proxy — run{" "}
              <span className="font-mono">npm run twin:install</span> once if this never finishes.
            </p>
          </div>
        )}
        <iframe
          key={iframeKey}
          title="PDEU Digital Twin"
          src={twinUrl}
          className="h-full min-h-0 w-full flex-1 border-0 bg-black"
          allow="fullscreen"
          referrerPolicy="same-origin"
          loading="eager"
          onLoad={() => setIframeBusy(false)}
        />
      </div>
    </div>
  );
};

export default TwinView;
