import { getUniversalWebSocketCandidates } from "@/services/universalInferenceWs";

export type UniversalWsMessage = any;

type Subscriber = {
  onMessage?: (msg: UniversalWsMessage) => void;
  onStatus?: (s: { connected: boolean; status?: string }) => void;
  onError?: (err: string) => void;
};

type Entry = {
  sessionId: string;
  ws: WebSocket | null;
  opened: boolean;
  connectedUrl: string | null;
  candidates: string[];
  connectIndex: number;
  subscribers: Set<Subscriber>;
  closeTimer: number | null;
  reconnectAttempts: number;
  reconnectTimer: number | null;
};

const pool = new Map<string, Entry>();

function notify(entry: Entry, fn: (s: Subscriber) => void) {
  for (const s of entry.subscribers) {
    try {
      fn(s);
    } catch {
      // ignore subscriber errors
    }
  }
}

function ensureConnected(entry: Entry) {
  if (entry.ws && (entry.ws.readyState === WebSocket.OPEN || entry.ws.readyState === WebSocket.CONNECTING)) return;
  if (!entry.subscribers.size) return;
  if (entry.reconnectTimer) return;

  const connectAt = (i: number) => {
    entry.connectIndex = i;
    const wsUrl = entry.candidates[i];
    if (!wsUrl) {
      notify(entry, (s) => s.onError?.(`WebSocket error talking to Universal dashboard (tried: ${entry.candidates.join(", ")})`));
      notify(entry, (s) => s.onStatus?.({ connected: false, status: "ws:failed" }));
      return;
    }

    const ws = new WebSocket(wsUrl);
    entry.ws = ws;
    entry.opened = false;
    entry.connectedUrl = wsUrl;
    notify(entry, (s) => s.onStatus?.({ connected: false, status: "connecting" }));

    ws.onopen = () => {
      entry.opened = true;
      entry.reconnectAttempts = 0;
      notify(entry, (s) => s.onStatus?.({ connected: true, status: "ws:open" }));
      try {
        ws.send(JSON.stringify({ type: "attach", sessionId: entry.sessionId }));
      } catch {
        // ignore
      }
    };

    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg?.type === "attached") {
        const st = typeof msg.status === "string" ? msg.status : "";
        notify(entry, (s) => s.onStatus?.({ connected: true, status: st ? `attached:${st}` : "attached" }));
        return;
      }
      if (msg?.type === "status") {
        const st = msg.status ? String(msg.status) : "status";
        notify(entry, (s) => s.onStatus?.({ connected: true, status: st }));
        return;
      }
      if (msg?.type === "error") {
        const m = typeof msg.message === "string" ? msg.message : "Universal inference error";
        notify(entry, (s) => s.onError?.(m));
        return;
      }
      notify(entry, (s) => s.onMessage?.(msg));
    };

    ws.onerror = () => {
      // If we never opened, failover to next candidate.
      if (!entry.opened) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        entry.ws = null;
        connectAt(i + 1);
        return;
      }
      notify(entry, (s) => s.onError?.("WebSocket error talking to Universal dashboard"));
      notify(entry, (s) => s.onStatus?.({ connected: false, status: "ws:error" }));
    };

    ws.onclose = () => {
      if (entry.ws === ws) entry.ws = null;
      notify(entry, (s) => s.onStatus?.({ connected: false, status: "ws:closed" }));
      // If there are still subscribers, reconnect with backoff to avoid a busy-loop when Universal is down.
      if (entry.subscribers.size) {
        entry.reconnectAttempts = Math.min(20, (entry.reconnectAttempts ?? 0) + 1);
        const base = 350;
        const max = 8000;
        const delay = Math.min(max, base * Math.pow(1.6, entry.reconnectAttempts - 1));
        entry.reconnectTimer = window.setTimeout(() => {
          entry.reconnectTimer = null;
          ensureConnected(entry);
        }, delay);
      }
    };
  };

  connectAt(entry.connectIndex || 0);
}

export function subscribeUniversalSession(
  sessionId: string,
  subscriber: Subscriber,
  opts?: { lingerMs?: number; autoStart?: boolean },
): () => void {
  const lingerMs = typeof opts?.lingerMs === "number" ? opts!.lingerMs : 8000;
  const autoStart = opts?.autoStart !== false;

  let entry = pool.get(sessionId);
  if (!entry) {
    entry = {
      sessionId,
      ws: null,
      opened: false,
      connectedUrl: null,
      candidates: getUniversalWebSocketCandidates(),
      connectIndex: 0,
      subscribers: new Set(),
      closeTimer: null,
      reconnectAttempts: 0,
      reconnectTimer: null,
    };
    pool.set(sessionId, entry);
  }

  // Cancel any pending close (tab switch / view switch).
  if (entry.closeTimer) {
    window.clearTimeout(entry.closeTimer);
    entry.closeTimer = null;
  }
  if (entry.reconnectTimer) {
    window.clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }

  entry.subscribers.add(subscriber);
  ensureConnected(entry);

  // Start inference if needed, after attach.
  if (autoStart) {
    // Best-effort fire-and-forget; server ignores if already running.
    window.setTimeout(() => {
      const ws = entry!.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "start", sessionId }));
        } catch {
          // ignore
        }
      }
    }, 250);
  }

  return () => {
    const e = pool.get(sessionId);
    if (!e) return;
    e.subscribers.delete(subscriber);
    if (e.subscribers.size) return;

    // Linger to prevent disconnects on quick navigation.
    e.closeTimer = window.setTimeout(() => {
      const cur = pool.get(sessionId);
      if (!cur || cur.subscribers.size) return;
      if (cur.reconnectTimer) {
        window.clearTimeout(cur.reconnectTimer);
        cur.reconnectTimer = null;
      }
      const ws = cur.ws;
      cur.ws = null;
      try {
        ws?.close();
      } catch {
        // ignore
      }
      pool.delete(sessionId);
    }, lingerMs);
  };
}

