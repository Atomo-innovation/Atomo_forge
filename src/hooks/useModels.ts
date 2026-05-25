import { useEffect, useState } from "react";
import type { ModelInfo } from "@/data/models";
import { fetchAsnnDashboardModels } from "@/services/asnnModelDashboard";

/** All AI models from asnn-dashboard/models (AI Models tab, cameras, live view). */
export function useModels() {
  const [remoteModels, setRemoteModels] = useState<ModelInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchAsnnDashboardModels(controller.signal)
      .then((models) => setRemoteModels(models))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to load models";
        setError(msg);
        setRemoteModels(null);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  const models = remoteModels ?? [];

  return { models, loading, error };
}
