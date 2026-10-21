import type { Guide } from "./schema";
import { curatedForToolkit, getCuratedGuide } from "@/lib/guides";
import { getGeneratedGuide } from "@/lib/agent/runs";

/** Find a guide by key: curated slug, toolkit slug with a curated guide, or a saved generated guide. */
export async function loadGuide(key: string): Promise<{ guide: Guide; url: string } | null> {
  const curated = getCuratedGuide(key) ?? curatedForToolkit(key);
  if (curated) return { guide: curated, url: `/apps/${curated.slug}` };
  const gen = await getGeneratedGuide(key).catch(() => null);
  if (gen) return { guide: gen, url: `/apps/gen/${gen.slug}` };
  return null;
}
