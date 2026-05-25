import type { CameraWorkspaceId } from "@/pages/Dashboard";
import { useModels } from "@/hooks/useModels";

/** Same ASNN model list for every workspace (Person auto-picks person model in the UI). */
export function useWorkspaceModels(_workspaceId: CameraWorkspaceId) {
  const { models, loading, error } = useModels();
  return { models, loading, error, backend: "asnn" as const };
}
