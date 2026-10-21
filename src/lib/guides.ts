import { CURATED_RAW } from "@/data/guides/index";
import { GuideSchema, type Guide } from "@/lib/guide/schema";

const curated: Guide[] = [];
for (const raw of CURATED_RAW) {
  const parsed = GuideSchema.safeParse(raw);
  if (parsed.success) curated.push(parsed.data);
  else console.warn("Skipping invalid curated guide", parsed.error.issues.slice(0, 3));
}

const ORDER = ["github", "gmail", "slack", "shopify", "linkedin", "salesforce", "outlook", "xero"];
const rank = (slug: string) => (ORDER.includes(slug) ? ORDER.indexOf(slug) : ORDER.length);
curated.sort((a, b) => rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug));

export function curatedGuides(): Guide[] {
  return curated;
}

export function getCuratedGuide(slug: string): Guide | null {
  return curated.find((g) => g.slug === slug) ?? null;
}

/** The curated guide covering a Composio toolkit, if any. */
export function curatedForToolkit(toolkitSlug: string): Guide | null {
  return curated.find((g) => g.composio_slug === toolkitSlug) ?? null;
}
