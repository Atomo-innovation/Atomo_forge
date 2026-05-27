import type { CameraWorkspaceId } from "@/pages/Dashboard";
import { useModels } from "@/hooks/useModels";
import { loadDynamicWorkspaces } from "@/lib/dynamicWorkspaces";

const STATIC_MODEL_FILTER: Record<string, string> = {
  cameras: "person",
  cameras4: "Safety",
};

export function useWorkspaceModels(workspaceId: CameraWorkspaceId) {
  const { models, loading, error } = useModels();

  const dynamic = loadDynamicWorkspaces();
  const filterName = STATIC_MODEL_FILTER[workspaceId] ?? dynamic[workspaceId];
  const filtered = filterName
    ? models.filter((m) => m.name.toLowerCase() === filterName.toLowerCase())
    : models;

  return { models: filtered, loading, error, backend: "asnn" as const };
}
