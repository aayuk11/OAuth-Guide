import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Callout, Disclosure, DocsShell, H2, PageHeader, Stats } from "@/components/docs";
import { curatedGuides } from "@/lib/guides";
import { CORRECTIONS, HANDS_ON } from "@/data/verification/log";
import sources from "@/data/verification/sources-latest.json";
import agentEval from "@/data/verification/agent-eval.json";
import type { Evidence } from "@/lib/guide/schema";

export const metadata: Metadata = { title: "Evidence", description: "What was verified, corrected, and left open." };

interface SourceResult {
  guide: string;
  status: "verified" | "not_found" | "unfetchable";
}
interface EvalRow {
  app: string;
  score: number;
  total: number;
  notes: string;
  level_match: boolean;
}

const TOC = [
  { id: "summary", label: "Summary" },
  { id: "reverification", label: "Source re-verification" },
  { id: "corrections", label: "What the research corrected" },
  { id: "conflicts", label: "Where sources disagree" },
  { id: "tested", label: "Tested by probe" },
  { id: "hands-on", label: "Still to test by hand" },
  { id: "accuracy", label: "Agent accuracy" },
  { id: "open", label: "Open questions" },
];

const IMPACT: Record<string, { label: string; tone: "warn" | "bad" | "accent" | "neutral" }> = {
  level: { label: "Changes the level", tone: "bad" },
  timeline: { label: "Changes the wait", tone: "warn" },
  cost: { label: "Changes the cost", tone: "warn" },
  setup: { label: "Changes setup", tone: "neutral" },
  composio: { label: "Composio finding", tone: "accent" },
};

export default function EvidencePage() {
  const guides = curatedGuides();
  const name = (slug: string) => guides.find((g) => g.slug === slug)?.app.name ?? (slug === "composio" ? "Composio" : slug);
  const results = (sources as { checked: string | null; results: SourceResult[] }).results;
  const checked = (sources as { checked: string | null }).checked;
  const byGuide = new Map<string, Record<SourceResult["status"], number>>();
  for (const r of results) {
    const m = byGuide.get(r.guide) ?? { verified: 0, not_found: 0, unfetchable: 0 };
    m[r.status]++;
    byGuide.set(r.guide, m);
  }
  const totals = results.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {} as Record<string, number>);
  const allEvidence = guides.flatMap((g) => g.evidence);
  const tested = guides.flatMap((g) => g.evidence.filter((e) => e.label === "tested").map((e) => ({ g, e })));
  const conflicts: { g: (typeof guides)[number]; a: Evidence; b: Evidence }[] = [];
  for (const g of guides) {
    const seen = new Set<string>();
    for (const e of g.evidence)
      for (const c of e.conflicts_with ?? []) {
        const key = [e.id, c].sort().join("|");
        const other = g.evidence.find((x) => x.id === c);
        if (other && !seen.has(key)) {
          seen.add(key);
          conflicts.push({ g, a: e, b: other });
        }
      }
  }
  const unknowns = guides.flatMap((g) => g.unknowns.map((u) => ({ g, u }))).sort((a, b) => Number(b.u.level_deciding) - Number(a.u.level_deciding));
  const ev = agentEval as { ran: boolean; date?: string; model?: string; results: EvalRow[] };

  return (
    <DocsShell active="/evidence" toc={TOC}>
      <PageHeader
        crumbs={[{ label: "How it works" }, { label: "Evidence" }]}
        title="Evidence"
        lead="What was verified, what the research corrected, and what is still open. Researched guides quote the provider's own documentation word for word; a script then re-checks every quote against its live page."
      />

      <section id="summary" className="scroll-mt-20 overflow-hidden rounded-lg border border-border">
        <Stats
          items={[
            { label: "Researched guides", value: guides.length },
            { label: "Cited sources", value: allEvidence.length },
            { label: "Quotes re-found on their pages", value: `${totals.verified ?? 0} of ${results.length}`, note: checked ? `Checked ${checked}` : undefined },
            { label: "Tested probes", value: tested.length },
          ]}
        />
      </section>

      <H2 id="reverification">Source re-verification</H2>
      <p className="text-sm text-fg-muted">
        <code className="inline">npm run verify:sources</code> fetches every Official and Reported source and checks the quote is still on the page. &ldquo;Can&apos;t fetch&rdquo; means the page blocks scripts or renders only in a browser; those quotes were confirmed another way, as noted on each source.
      </p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <thead>
            <tr>
              <th>Guide</th>
              <th>Found</th>
              <th>Not found</th>
              <th>Can&apos;t fetch</th>
            </tr>
          </thead>
          <tbody>
            {[...byGuide.entries()].map(([g, m]) => (
              <tr key={g}>
                <td className="strong">
                  <Link href={`/apps/${g}`} className="link">
                    {name(g)}
                  </Link>
                </td>
                <td className="text-ok">{m.verified}</td>
                <td className={m.not_found ? "text-bad" : ""}>{m.not_found}</td>
                <td className={m.unfetchable ? "text-warn" : ""}>{m.unfetchable}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="corrections" aside={`${CORRECTIONS.length} corrections`}>
        What the research corrected
      </H2>
      <p className="mb-3 text-sm text-fg-muted">Claims from the first planning pass that turned out to be wrong or out of date. Each is backed by sources in the linked guide.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <thead>
            <tr>
              <th>App</th>
              <th>Was</th>
              <th>Now</th>
              <th>Impact</th>
            </tr>
          </thead>
          <tbody>
            {CORRECTIONS.map((c, i) => (
              <tr key={i}>
                <td className="strong">
                  {c.guide === "composio" ? (
                    "Composio"
                  ) : (
                    <Link href={`/apps/${c.guide}`} className="link">
                      {name(c.guide)}
                    </Link>
                  )}
                </td>
                <td className="text-fg-subtle line-through decoration-fg-subtle/40">{c.before}</td>
                <td>{c.after}</td>
                <td>
                  <Badge tone={IMPACT[c.impact].tone}>{IMPACT[c.impact].label}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="conflicts" aside={`${conflicts.length} pairs`}>
        Where sources disagree
      </H2>
      <p className="mb-3 text-sm text-fg-muted">The guides show both sources and the full range, and lower confidence to Medium. Plan for the longer figure.</p>
      <Disclosure title="Show conflicting sources" meta={`${conflicts.length}`}>
        <ul className="space-y-4">
          {conflicts.map(({ g, a, b }, i) => (
            <li key={i}>
              <div className="font-medium text-fg">{g.app.name}</div>
              {[a, b].map((e) => (
                <p key={e.id} className="mt-1 border-l-2 border-border pl-3 text-xs text-fg-muted">
                  <a href={e.url ?? "#"} target="_blank" rel="noreferrer noopener" className="link">
                    {e.title}
                  </a>
                  {e.excerpt && <> — “{e.excerpt.length > 220 ? `${e.excerpt.slice(0, 220)}…` : e.excerpt}”</>}
                </p>
              ))}
            </li>
          ))}
        </ul>
      </Disclosure>

      <H2 id="tested" aside={`${tested.length} probes`}>
        Tested by probe
      </H2>
      <p className="mb-3 text-sm text-fg-muted">Requests actually made, and what came back. This is how &ldquo;register manually&rdquo; versus &ldquo;registers itself&rdquo; is established.</p>
      <Disclosure title="Show probe results" meta={`${tested.length}`}>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="table">
            <tbody>
              {tested.map(({ g, e }) => (
                <tr key={`${g.slug}-${e.id}`}>
                  <td className="strong">{g.app.name}</td>
                  <td>
                    <code className="break-all font-mono text-xs">{e.url}</code>
                    <div className="mt-0.5 text-xs">{e.excerpt}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>

      <H2 id="hands-on">Still to test by hand</H2>
      <p className="mb-3 text-sm text-fg-muted">These need real provider accounts and a person&apos;s identity. Until done, the claims stay Official, not Tested.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <thead>
            <tr>
              <th>App</th>
              <th>Check</th>
              <th>Needs</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {HANDS_ON.map((h, i) => (
              <tr key={i}>
                <td className="strong">{name(h.guide)}</td>
                <td>{h.check}</td>
                <td>{h.needs}</td>
                <td>
                  <Badge tone={h.status === "done" ? "ok" : "neutral"}>{h.status === "done" ? "Done" : "To do"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="accuracy">Agent accuracy</H2>
      {ev.ran ? (
        <>
          <p className="mb-3 text-sm text-fg-muted">
            The live agent was run cold on each researched app ({ev.date}, {ev.model}) and scored against the researched guide on level range, level-deciding answers and gates.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="table">
              <tbody>
                {ev.results.map((r) => (
                  <tr key={r.app}>
                    <td className="strong">{r.app}</td>
                    <td>
                      {r.score}/{r.total}
                    </td>
                    <td>
                      <Badge tone={r.level_match ? "ok" : "bad"}>{r.level_match ? "Level range matches" : "Level range differs"}</Badge>
                    </td>
                    <td>{r.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Callout tone="neutral" title="Not run on this build">
          With an API key, <code className="inline">npm run eval:agent</code> runs the live agent cold on every researched app and scores it against the researched guide. The result appears here.
        </Callout>
      )}

      <H2 id="open" aside={`${unknowns.length} questions`}>
        Open questions
      </H2>
      <Disclosure title="Show open questions" meta={`${unknowns.filter((x) => x.u.level_deciding).length} could change a level`}>
        <ul className="space-y-3">
          {unknowns.map(({ g, u }, i) => (
            <li key={i}>
              <span className="font-medium text-fg">{g.app.name}:</span> <span className="text-fg-muted">{u.question}</span> {u.level_deciding && <Badge tone="bad">Could change the level</Badge>}
              <div className="text-xs text-fg-subtle">How to find out: {u.how_to_find_out}</div>
            </li>
          ))}
        </ul>
      </Disclosure>
    </DocsShell>
  );
}
