import { useCallback, useEffect, useState } from "react";
import {
  DETECTION_EVENTS_CHANGED_EVENT,
  getDetectionEventsCache,
  listDetectionEvents,
  type StoredDetectionEvent,
} from "@/services/detectionEventsStore";

/** Shared events list with in-memory cache — fast when switching back to Events tab. */
export function useDetectionEvents(limit?: number) {
  const [events, setEvents] = useState<StoredDetectionEvent[]>(() => {
    const cached = getDetectionEventsCache();
    if (!cached) return [];
    if (typeof limit === "number" && limit > 0) return cached.slice(0, limit);
    return cached;
  });
  const [loading, setLoading] = useState(() => getDetectionEventsCache() === null);

  const reload = useCallback(() => {
    setLoading(true);
    return listDetectionEvents(limit)
      .then((list) => {
        setEvents(list);
        return list;
      })
      .catch(() => {
        setEvents([]);
        return [] as StoredDetectionEvent[];
      })
      .finally(() => setLoading(false));
  }, [limit]);

  useEffect(() => {
    void reload();
    const onChanged = () => void reload();
    window.addEventListener(DETECTION_EVENTS_CHANGED_EVENT, onChanged as EventListener);
    return () => window.removeEventListener(DETECTION_EVENTS_CHANGED_EVENT, onChanged as EventListener);
  }, [reload]);

  return { events, loading, reload };
}
