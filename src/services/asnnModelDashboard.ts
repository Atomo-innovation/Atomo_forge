import type { ModelInfo } from "@/data/models";
import { universalModelIcon } from "@/data/models";
import { authApiUrl, readForgeApiJson } from "@/services/authApiUrl";

type AsnnDashboardModel = {
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

export async function fetchAsnnDashboardModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  const url = authApiUrl("/asnn/api/models");
  const res = await fetch(url, { signal });
  const data = await readForgeApiJson<{ models?: AsnnDashboardModel[] }>(res);
  if (!res.ok) {
    throw new Error(
      data?.error && typeof data.error === "string"
        ? data.error
        : `ASNN models API failed (${res.status}). Is auth-server running?`,
    );
  }
  if (!data) {
    throw new Error(`ASNN models API returned invalid JSON from ${url}.`);
  }
  const models = Array.isArray(data.models) ? data.models : [];

  // Only models with both NPU binaries — incomplete folders cause exit code 1 at runtime.
  const complete = models.filter((m) => Boolean(m.nb_path && m.lib_path));

  return complete.map((m) => ({
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

export async function deleteAsnnModel(folderName: string): Promise<void> {
  const name = folderName.trim();
  if (!name) throw new Error("Model name is required");

  const url = authApiUrl(`/asnn/api/models/${encodeURIComponent(name)}`);
  const res = await fetch(url, { method: "DELETE" });
  const data = await readForgeApiJson<{ ok?: boolean; error?: string }>(res);
  // UX: if the folder is already gone, treat it as deleted.
  if (res.status === 404) return;
  if (!res.ok || !data?.ok) {
    throw new Error(
      data?.error && typeof data.error === "string"
        ? data.error
        : `Delete model failed (${res.status})`,
    );
  }
}
