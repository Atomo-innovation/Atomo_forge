import { getDetectionEventCrop } from "@/services/detectionEventsStore";

/** Load crop thumbnails only for the given event ids (e.g. current table page). */
export async function loadDetectionEventThumbUrls(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: Record<string, string> = {};
  await Promise.all(
    unique.map(async (id) => {
      const blob = await getDetectionEventCrop(id);
      if (blob && blob.size > 0) out[id] = URL.createObjectURL(blob);
    }),
  );
  return out;
}

export function revokeThumbUrls(urls: Record<string, string>): void {
  for (const url of Object.values(urls)) URL.revokeObjectURL(url);
}
