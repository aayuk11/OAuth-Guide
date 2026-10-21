import type { Metadata } from "next";
import { DocsShell } from "@/components/docs";
import { LiveRun } from "@/components/live-run";
import { STAGES } from "@/lib/agent/events";

export const metadata: Metadata = { title: "Live research", robots: { index: false } };
export const dynamic = "force-dynamic";

const clean = (v: string | string[] | undefined) =>
  (typeof v === "string" ? v : "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

export default async function GeneratePage({ searchParams }: PageProps<"/generate">) {
  const sp = await searchParams;
  const q = clean(sp.q);
  const toolkit = clean(sp.toolkit).replace(/[^a-z0-9_]/g, "");
  const run = clean(sp.run).replace(/[^A-Za-z0-9_-]/g, "");
  return (
    <DocsShell active="/apps" wide>
      <LiveRun
        query={q}
        toolkit={toolkit || null}
        fresh={sp.fresh === "1"}
        runId={run || null}
        stages={STAGES.map((s) => ({ id: s.id, label: s.label }))}
      />
    </DocsShell>
  );
}
