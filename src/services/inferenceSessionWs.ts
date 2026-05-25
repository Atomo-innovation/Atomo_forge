import type { InferenceBackendId } from "@/lib/inferenceBackend";
import { getInferenceWebSocketCandidates } from "@/services/inferenceWs";

export type InferenceWsMessage = Record<string, unknown>;

type Subscriber = {
  onMessage?: (msg: InferenceWsMessage) => void;
  onStatus?: (s: { connected: boolean; status?: string }) => void;
  onError?: (err: string) => void;
};

type Entry = {
  sessionId: string;
  backend: InferenceBackendId;
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

function poolKey(sessionId: string, backend: InferenceBackendId) {
  return `${backend}:${sessionId}`;
}

function notify(entry: Entry, fn: (s: Subscriber) => void) {
  for (const s of entry.subscribers) {
    try {
      fn(s);
    } catch {
      // ignore
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
      notify(entry, (s) =>
        s.onError?.(`WebSocket error (tried: ${entry.candidates.join(", ")})`),
      );
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
      let msg: InferenceWsMessage;
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
        if (st === "stopped" || st === "error") {
          notify(entry, (s) => s.onMessage?.(msg));
        }
        return;
      }
      if (msg?.type === "error") {
        const m = typeof msg.message === "string" ? msg.message : "Inference error";
        notify(entry, (s) => s.onError?.(m));
        return;
      }
      notify(entry, (s) => s.onMessage?.(msg));
    };

    ws.onerror = () => {
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
      notify(entry, (s) => s.onError?.("WebSocket error"));
      notify(entry, (s) => s.onStatus?.({ connected: false, status: "ws:error" }));
    };

    ws.onclose = () => {
      if (entry.ws === ws) entry.ws = null;
      notify(entry, (s) => s.onStatus?.({ connected: false, status: "ws:closed" }));
      if (entry.subscribers.size) {
        entry.reconnectAttempts = Math.min(20, (entry.reconnectAttempts ?? 0) + 1);
        const delay = Math.min(8000, 350 * Math.pow(1.6, entry.reconnectAttempts - 1));
        entry.reconnectTimer = window.setTimeout(() => {
          entry.reconnectTimer = null;
          ensureConnected(entry);
        }, delay);
      }
    };
  };

  connectAt(entry.connectIndex || 0);
}

export function subscribeInferenceSession(
  sessionId: string,
  backend: InferenceBackendId,
  subscriber: Subscriber,
  opts?: { lingerMs?: number; autoStart?: boolean },
): () => void {
  const lingerMs = typeof opts?.lingerMs === "number" ? opts.lingerMs : 8000;
  const autoStart = opts?.autoStart !== false;
  const key = poolKey(sessionId, backend);

  let entry = pool.get(key);
  if (!entry) {
    entry = {
      sessionId,
      backend,
      ws: null,
      opened: false,
      connectedUrl: null,
      candidates: getInferenceWebSocketCandidates(backend),
      connectIndex: 0,
      subscribers: new Set(),
      closeTimer: null,
      reconnectAttempts: 0,
      reconnectTimer: null,
    };
    pool.set(key, entry);
  }

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

  if (autoStart) {
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
    const e = pool.get(key);
    if (!e) return;
    e.subscribers.delete(subscriber);
    if (e.subscribers.size) return;

    e.closeTimer = window.setTimeout(() => {
      const cur = pool.get(key);
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
      pool.delete(key);
    }, lingerMs);
  };
}
