import type { ModelInfo } from "@/data/models";
import { universalModelIcon } from "@/data/models";
import { authApiUrl, readForgeApiJson } from "@/services/authApiUrl";

type UniversalDashboardModel = {
  name: string;
  dir?: string;
  classes?: string[];
  num_cls?: number;
  yaml?: string | null;
  nb?: string;
  lib?: string;
  nb_path?: string;
  lib_path?: string;
};

export async function fetchUniversalDashboardModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  // Same-origin: Vite/Caddy proxy `/universal` → auth-server :3003. Optional: VITE_AUTH_API_ORIGIN.
  const url = authApiUrl("/universal/api/models");
  const res = await fetch(url, { signal });
  const data = await readForgeApiJson<{ models?: UniversalDashboardModel[] }>(res);
  if (!res.ok) {
    throw new Error(
      data?.error && typeof data.error === "string"
        ? data.error
        : `Models API failed (${res.status}). Is auth-server running? Try: npm run dev`,
    );
  }
  if (!data) {
    throw new Error(
      `Models API returned invalid JSON from ${url}. Ensure auth-server is on port 3003 and /universal is proxied.`,
    );
  }
  const models = Array.isArray(data.models) ? data.models : [];

  return models.map((m) => ({
    id: m.name,
    name: m.name,
    icon: universalModelIcon,
    classes: Array.isArray(m.classes) ? m.classes : undefined,
    version: m.yaml ? "data.yaml" : undefined,
    npuOptimized: true,
    dir: m.dir,
    nb: m.nb,
    lib: m.lib,
    nb_path: m.nb_path,
    lib_path: m.lib_path,
    yaml: m.yaml,
  }));
}

