import { useCallback, useEffect, useMemo, useState } from "react";
import type { CameraWorkspaceId } from "@/pages/Dashboard";
import {
  DETECTION_EVENTS_CHANGED_EVENT,
  type StoredDetectionEvent,
} from "@/services/detectionEventsStore";
import { useDetectionEvents } from "@/hooks/useDetectionEvents";
import {
  DETECTION_EVENTS_DB_CHANGED_EVENT,
  fetchDetectionEventsDbAvailable,
  filterDetectionEventsLocal,
  listDetectionEventsFromDb,
  searchDetectionEventsInDb,
} from "@/services/detectionEventsDb";

const SEARCH_DEBOUNCE_MS = 350;
const DB_RELOAD_DEBOUNCE_MS = 400;

export function useWorkspaceDetectionSearch(
  workspaceId: CameraWorkspaceId,
  cameraIds: string[],
) {
  const { events: localEvents, loading: localLoading } = useDetectionEvents(1000);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [dbAvailable, setDbAvailable] = useState(false);
  const [dbRecentEvents, setDbRecentEvents] = useState<StoredDetectionEvent[] | null>(null);
  const [dbSearchResults, setDbSearchResults] = useState<StoredDetectionEvent[] | null>(null);
  const [dbLoading, setDbLoading] = useState(false);

  const cameraIdSet = useMemo(() => new Set(cameraIds), [cameraIds]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    void fetchDetectionEventsDbAvailable(workspaceId, true).then(setDbAvailable);
  }, [workspaceId]);

  const loadDbRecent = useCallback(async () => {
    if (!cameraIds.length) {
      setDbRecentEvents([]);
      return;
    }
    const ok = await fetchDetectionEventsDbAvailable(workspaceId, true);
    setDbAvailable(ok);
    if (!ok) {
      setDbRecentEvents(null);
      return;
    }
    const rows = await listDetectionEventsFromDb({
      workspaceId,
      cameraIds,
      limit: 500,
    });
    setDbRecentEvents(rows);
  }, [workspaceId, cameraIds]);

  const runSearch = useCallback(async () => {
    const q = debouncedQ;
    if (!q) {
      setDbSearchResults(null);
      setDbLoading(false);
      return;
    }
    if (!cameraIds.length) {
      setDbSearchResults([]);
      return;
    }
    setDbLoading(true);
    try {
      const ok = await fetchDetectionEventsDbAvailable(workspaceId, true);
      setDbAvailable(ok);
      if (ok) {
        const fromDb = await searchDetectionEventsInDb({
          workspaceId,
          cameraIds,
          q,
          limit: 500,
        });
        setDbSearchResults(fromDb);
        return;
      }
      setDbSearchResults(
        filterDetectionEventsLocal(localEvents, { workspaceId, cameraIds: cameraIdSet, q }),
      );
    } finally {
      setDbLoading(false);
    }
  }, [debouncedQ, workspaceId, cameraIds, cameraIdSet, localEvents]);

  useEffect(() => {
    void loadDbRecent();
  }, [loadDbRecent]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  useEffect(() => {
    let t: number | undefined;
    const scheduleReload = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        void loadDbRecent();
        if (debouncedQ) void runSearch();
      }, DB_RELOAD_DEBOUNCE_MS);
    };
    window.addEventListener(DETECTION_EVENTS_CHANGED_EVENT, scheduleReload as EventListener);
    window.addEventListener(DETECTION_EVENTS_DB_CHANGED_EVENT, scheduleReload as EventListener);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener(DETECTION_EVENTS_CHANGED_EVENT, scheduleReload as EventListener);
      window.removeEventListener(DETECTION_EVENTS_DB_CHANGED_EVENT, scheduleReload as EventListener);
    };
  }, [debouncedQ, loadDbRecent, runSearch]);

  const recentEvents = useMemo(() => {
    if (debouncedQ) {
      if (dbSearchResults) return dbSearchResults;
      return filterDetectionEventsLocal(localEvents, {
        workspaceId,
        cameraIds: cameraIdSet,
        q: debouncedQ,
      });
    }
    if (dbAvailable && dbRecentEvents) return dbRecentEvents;
    return localEvents
      .filter((e) => cameraIdSet.has(e.cameraId))
      .filter((e) => (e.detectionWorkspace ?? "cameras") === workspaceId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [
    debouncedQ,
    dbSearchResults,
    dbAvailable,
    dbRecentEvents,
    localEvents,
    workspaceId,
    cameraIdSet,
  ]);

  const useServerImages = dbAvailable && recentEvents.length > 0;

  return {
    searchQuery,
    setSearchQuery,
    recentEvents,
    loading: localLoading || dbLoading,
    isSearchActive: Boolean(debouncedQ),
    dbAvailable,
    useServerImages,
  };
}
