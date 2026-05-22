import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ELECTRON_LOCAL_HTTP,
  fetchDevNetworkInfo,
  getClientLanHttpUrl,
  getOtherDevicesUrl,
  type DevNetworkInfo,
} from "@/services/devNetworkInfo";

const LanAccessPanel = () => {
  const [info, setInfo] = useState<DevNetworkInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const remote = await fetchDevNetworkInfo();
    setInfo(remote);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const primaryUrl = useMemo(() => {
    const remote = info?.otherDevicesUrl || info?.electronLocalHttpUrl;
    if (remote?.trim()) return remote.trim().replace(/\/$/, "");
    return getOtherDevicesUrl();
  }, [info]);

  const fallbackIpUrl = useMemo(() => {
    const remote = info?.lanHttpUrl;
    if (remote?.trim()) return remote.trim().replace(/\/$/, "");
    return getClientLanHttpUrl();
  }, [info]);

  const mdnsActive = info?.mdnsActive ?? primaryUrl === ELECTRON_LOCAL_HTTP;

  const copyUrl = (url: string) => {
    if (!url) {
      toast.error("URL not available", {
        description: "Run npm run dev on the host PC and ensure Caddy is on port 80.",
      });
      return;
    }
    void navigator.clipboard.writeText(url).then(
      () => toast.success("Copied", { description: url }),
      () => toast.error("Could not copy to clipboard"),
    );
  };

  if (!import.meta.env.DEV) return null;

  return (
    <section className="rounded-xl border border-primary/25 bg-primary/5 p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/15 p-2">
          <Wifi className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground">Open on other devices (same Wi‑Fi)</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            On a phone or another PC, type{" "}
            <span className="font-mono font-medium text-foreground">http://electron.local</span> in the browser
            (same Wi‑Fi as this machine).
          </p>
        </div>
      </div>

      {loading && !primaryUrl ? (
        <p className="text-sm text-muted-foreground">Detecting network…</p>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Share this URL</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="flex-1 rounded-lg border border-primary/30 bg-background px-3 py-2.5 text-sm font-mono break-all">
                {primaryUrl || ELECTRON_LOCAL_HTTP}
              </code>
              <Button
                type="button"
                variant="secondary"
                className="shrink-0 gap-2"
                onClick={() => copyUrl(primaryUrl || ELECTRON_LOCAL_HTTP)}
              >
                <Copy className="h-4 w-4" />
                Copy
              </Button>
            </div>
          </div>

          {fallbackIpUrl && fallbackIpUrl !== primaryUrl ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">If electron.local does not open, use the IP instead:</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono break-all">
                  {fallbackIpUrl}
                </code>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => copyUrl(fallbackIpUrl)}>
                  Copy IP
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {!mdnsActive ? (
        <p className="text-sm text-amber-700 dark:text-amber-400 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          mDNS is off on this PC. Run once: <code className="text-xs bg-muted px-1 rounded">npm run lan:setup</code>{" "}
          (sudo), then restart <code className="text-xs bg-muted px-1 rounded">npm run dev</code> so other devices can
          resolve <span className="font-mono">electron.local</span>.
        </p>
      ) : null}

      <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
        <li>Type exactly <span className="font-mono">http://electron.local</span> (include http://).</li>
        <li>Do not use <span className="font-mono">https://</span> on other devices unless you installed the Caddy CA.</li>
        <li>Guest Wi‑Fi often blocks device-to-device access.</li>
        <li>Firewall: <code className="bg-muted px-1 rounded">sudo ufw allow 80/tcp</code></li>
      </ul>

      {info?.localHttpsUrl ? (
        <p className="text-xs text-muted-foreground">
          This PC only:{" "}
          <a href={info.localHttpsUrl} className="text-primary underline-offset-2 hover:underline">
            {info.localHttpsUrl}
          </a>
        </p>
      ) : null}
    </section>
  );
};

export default LanAccessPanel;
