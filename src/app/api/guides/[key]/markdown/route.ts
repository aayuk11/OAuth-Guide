import { loadGuide } from "@/lib/guide/load";
import { parseIntake } from "@/lib/guide/intake";
import { guideToMarkdown } from "@/lib/guide/markdown";
import { buildView } from "@/lib/guide/view";

export const dynamic = "force-dynamic";

/** Markdown export for tickets and docs. Includes the legend so it stands alone. */
export async function GET(req: Request, ctx: RouteContext<"/api/guides/[key]/markdown">) {
  const { key } = await ctx.params;
  const found = await loadGuide(key);
  if (!found) return new Response("No guide with that key.", { status: 404 });
  const u = new URL(req.url);
  const sp = Object.fromEntries(u.searchParams);
  const view = buildView(found.guide, parseIntake(sp, found.guide), sp.path ?? null);
  const share = new URL(found.url, u.origin);
  for (const k of ["audience", "access", "brand", "path"]) if (sp[k]) share.searchParams.set(k, sp[k]);
  const md = guideToMarkdown(view, share.toString());
  const headers: Record<string, string> = { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" };
  if (sp.download) headers["Content-Disposition"] = `attachment; filename="${found.guide.slug}-oauth-readiness.md"`;
  return new Response(md, { headers });
}
