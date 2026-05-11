import type { ModelInfo } from "@/data/models";
import { universalModelIcon } from "@/data/models";

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
  // Use same-origin proxy to avoid CORS issues in the browser.
  // Dev server routes `/universal/*` to the Forge backend, which embeds Universal.
  const res = await fetch(`/universal/api/models`, { signal });
  if (!res.ok) throw new Error(`Universal dashboard /api/models failed (${res.status})`);
  const data = (await res.json()) as { models?: UniversalDashboardModel[] };
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

