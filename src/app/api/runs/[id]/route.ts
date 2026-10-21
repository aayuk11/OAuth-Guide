import { getRun } from "@/lib/agent/runs";

export const dynamic = "force-dynamic";

/** Run status and events, for reconnecting after a closed tab or a dropped stream. */
export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  const run = await getRun(id);
  if (!run) return Response.json({ error: "Run not found (runs are kept for 7 days)." }, { status: 404 });
  return Response.json(run, { headers: { "Cache-Control": "no-store" } });
}
