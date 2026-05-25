import type { ModelInfo } from "@/data/models";

/** Default ASNN person model for the Person workspace (no manual model picker). */
export function pickDefaultPersonModel(models: ModelInfo[]): ModelInfo | null {
  if (!models.length) return null;

  const exact = models.find((m) => m.id.toLowerCase() === "person" || m.name.toLowerCase() === "person");
  if (exact) return exact;

  const singlePersonClass = models.find(
    (m) => m.classes?.length === 1 && m.classes[0].toLowerCase() === "person",
  );
  if (singlePersonClass) return singlePersonClass;

  const peopleKh = models.find((m) => m.id.toLowerCase() === "people_kh");
  if (peopleKh) return peopleKh;

  return models[0] ?? null;
}
