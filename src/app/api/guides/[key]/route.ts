import { loadGuide } from "@/lib/guide/load";
import { parseIntake } from "@/lib/guide/intake";
import { buildView } from "@/lib/guide/view";

export const dynamic = "force-dynamic";

/**
 * Guide JSON plus the computed answer for the given intake (?audience=&access=&brand=&path=).
 * Stable enough to power a docs badge, a dashboard hint or a coding agent's tool.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/guides/[key]">) {
  const { key } = await ctx.params;
  const found = await loadGuide(key);
  if (!found) return Response.json({ error: "No guide with that key." }, { status: 404 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const view = buildView(found.guide, parseIntake(sp, found.guide), sp.path ?? null);
  return Response.json(
    {
      url: found.url,
      computed: {
        intake: view.intake,
        path: view.path.id,
        verdict: { type: view.verdict.type, title: view.verdict.title },
        level: { value: view.level.value, name: view.level.name, unconfirmed: view.level.unconfirmed },
        hands_on: { minutes: view.effort.minutes, label: view.effort.label, basis: "estimate" },
        calendar_wait: { min_business_days: view.wait.min, max_business_days: view.wait.max, label: view.wait.label, basis: view.wait.basis, open_ended: view.wait.openEnded },
        confidence: view.confidence,
        paths: view.summaries.map((s) => ({ id: s.path.id, label: s.path.label, level: s.level.value, wait: s.wait.label, effort: s.effort.label })),
      },
      guide: found.guide,
    },
    { headers: { "Cache-Control": found.guide.kind === "curated" ? "public, max-age=300" : "no-store" } },
  );
}
