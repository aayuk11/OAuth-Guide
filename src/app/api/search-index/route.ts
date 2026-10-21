import { searchIndex } from "@/lib/catalog";
import { curatedGuides } from "@/lib/guides";

export const dynamic = "force-static";

/** Slim catalogue for client-side search suggestions. */
export function GET() {
  const curated = new Set(curatedGuides().map((g) => g.composio_slug));
  const items = searchIndex().map((t) => (curated.has(t.s) ? { ...t, g: 1 } : t));
  return Response.json(items, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
