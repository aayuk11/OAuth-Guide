import Link from "next/link";
import type { ReactNode } from "react";
import { COMPOSIO_REDIRECT_URI } from "@/lib/catalog";
import { AUDIENCE_LABEL, intakeQuery } from "@/lib/guide/intake";
import { CORE_QUESTIONS, GATE_LEVELS, type Gate, type ScopeTier } from "@/lib/guide/schema";
import { formatGateWait, LEVEL_MEANING, stepMinutes } from "@/lib/guide/scoring";
import type { GuideView } from "@/lib/guide/view";
import { AgentCheck, CopyButton, SetupBar, StepList, Tabs, type StepItem } from "./client";
import { Badge, Callout, Cite, CodeBlock, Disclosure, H2, LevelBadge, OwnerBadge, OWNER_TEXT, Rich, Stats, type EvidenceIndex, type TocItem } from "./docs";
import { OpenOnHash } from "./hash";

export function evidenceIndex(view: GuideView): EvidenceIndex {
  const idx: EvidenceIndex = {};
  view.evidenceList.forEach((e, i) => (idx[e.id] = { n: i + 1, e }));
  return idx;
}

export const GUIDE_TOC: TocItem[] = [
  { id: "summary", label: "Summary" },
  { id: "setup", label: "Setup steps" },
  { id: "composio", label: "Connect to Composio" },
  { id: "approval", label: "Approval and timeline" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "reference", label: "Reference" },
];

const BADGE_KIND: Record<string, string> = { cost: "Cost", identity: "Identity", after_launch: "After launch", customer_admin: "Customer admin" };

/* ---------- Setup selector ---------- */

export function GuideSetup({ view, base }: { view: GuideView; base: string }) {
  const matching = new Set(view.choice.matching.map((p) => p.id));
  const paths = view.summaries.map((s) => ({ id: s.path.id, label: s.path.label, level: s.level.value, matches: matching.has(s.path.id) }));
  const { audience, access, brand } = view.intake;
  return <SetupBar key={`${audience}-${access}-${brand}-${view.path.id}`} base={base} audience={audience} access={access} brand={brand} pathId={view.path.id} paths={paths} />;
}

/* ---------- Summary ---------- */

function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <div className="pt-1 text-xs text-fg-subtle">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function CopyLine({ value }: { value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-code px-2.5 py-1.5">
      <code className="min-w-0 flex-1 break-all font-mono text-[0.78rem] leading-relaxed text-fg">{value}</code>
      <CopyButton text={value} />
    </div>
  );
}

export function Summary({ view, index }: { view: GuideView; index: EvidenceIndex }) {
  const { verdict, level, effort, wait, confidence, path, toolkit } = view;
  const scopes = view.scopeAdvice.pathScopes.map((s) => s.scope);
  const requiredFields = toolkit?.oauth?.connection_fields.filter((f) => f.required) ?? [];
  const confTone = { high: "text-ok", medium: "text-warn", low: "text-bad" }[confidence.value];
  return (
    <section id="summary" aria-label="Summary" className="scroll-mt-20 overflow-hidden rounded-lg border border-border">
      <div className="p-4 sm:p-5">
        <div className="text-xs text-fg-subtle">Do I need my own OAuth app?</div>
        <p className="mt-1 text-lg font-semibold leading-snug text-fg">{verdict.title}</p>
        <p className="mt-1 text-sm text-fg-muted">{verdict.summary}</p>
        {verdict.reasons.length > 0 && (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-accent">Why</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-muted">
              {verdict.reasons.map((r, i) => (
                <li key={i}>
                  {r.text}
                  {r.evidence && r.evidence.length > 0 && <Cite ids={r.evidence} index={index} />}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <Stats
        items={[
          { label: "Difficulty", value: <LevelBadge level={level.value} unconfirmed={level.unconfirmed} />, note: level.unconfirmed ? "Could be higher: open question" : LEVEL_MEANING[level.value] },
          { label: "Hands-on effort", value: effort.label.replace("about ", "~"), note: "Our estimate" },
          { label: "Calendar wait", value: wait.label, note: wait.sameDay ? "No review on this path" : wait.conflict ? "Sources disagree; full range shown" : wait.basis ? `From ${wait.basis} sources` : "No source states a timeline" },
          { label: "Confidence", value: <span className={`capitalize ${confTone}`}>{confidence.value}</span>, note: confidence.reasons[0] },
        ]}
      />
      <div className="space-y-3 border-t border-border p-4 sm:p-5">
        <KeyValue label="Redirect URI">
          <CopyLine value={COMPOSIO_REDIRECT_URI} />
        </KeyValue>
        {scopes.length > 0 && (
          <KeyValue label="Scopes for this path">
            <CopyLine value={scopes.join(" ")} />
          </KeyValue>
        )}
        {toolkit && (
          <KeyValue label="Composio toolkit">
            <code className="inline">{toolkit.slug}</code>
            {requiredFields.length > 0 && <span className="ml-2 text-sm text-fg-muted">Each user also provides: {requiredFields.map((f) => f.label).join(", ")}</span>}
          </KeyValue>
        )}
      </div>
      <div className="border-t border-border bg-bg-subtle p-4 sm:p-5">
        <div className="mb-2 text-xs text-fg-subtle">Start with</div>
        <ol className="space-y-1.5 text-sm">
          {path.start_here.map((s, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-fg">{s.when}:</span>
              <span className="text-fg-muted">
                <Rich text={s.action} />
              </span>
              <OwnerBadge owner={s.owner} />
            </li>
          ))}
        </ol>
        {path.badges.length > 0 && (
          <p className="mt-3 text-sm text-fg-muted">
            Also watch for: {[...new Set(path.badges.map((b) => BADGE_KIND[b.kind]))].join(", ")}.{" "}
            <a href="#watch-for" className="link">
              Details
            </a>
          </p>
        )}
      </div>
    </section>
  );
}

/* ---------- Setup steps ---------- */

const STOP = new Set(["the", "a", "an", "and", "or", "of", "for", "your", "only", "path", "users", "with", "to", "in"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9.]+/).filter((w) => w.length > 2 && !STOP.has(w));

const AUDIENCE_WORDS = { external: ["external", "customers", "customer", "public"], own_org: ["internal", "organisation", "organization", "own", "workspace"] };

/** Pick the value tab that best matches the selected path and audience (e.g. "Read path" for a read path). */
function bestMatch(labels: string[], pathLabel: string, audience: keyof typeof AUDIENCE_WORDS): number {
  const target = new Set([...words(pathLabel), ...AUDIENCE_WORDS[audience]]);
  let best = 0;
  let bestScore = 0;
  labels.forEach((l, i) => {
    const score = words(l).filter((w) => target.has(w)).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

export function SetupSteps({ view, index, storageKey }: { view: GuideView; index: EvidenceIndex; storageKey: string }) {
  const items: StepItem[] = view.steps.map((s) => ({
    id: s.id,
    title: s.title,
    owner: OWNER_TEXT[s.owner],
    meta: (
      <span className="flex items-center gap-2">
        <OwnerBadge owner={s.owner} />
        <span className="text-xs text-fg-subtle">~{stepMinutes(s)} min</span>
        {s.evidence.length > 0 && <Cite ids={s.evidence} index={index} />}
      </span>
    ),
    body: (
      <div className="space-y-2 text-sm leading-relaxed text-fg-muted">
        <p>
          <Rich text={s.detail} />
        </p>
        {s.paste && s.paste.length === 1 && <CodeBlock label={s.paste[0].label} code={s.paste[0].value} />}
        {s.paste && s.paste.length > 1 && (
          <Tabs initial={bestMatch(s.paste.map((p) => p.label), view.path.label, view.intake.audience)} tabs={s.paste.map((p) => ({ label: p.label, content: <CodeBlock code={p.value} /> }))} />
        )}
        {s.link && (
          <a href={s.link.url} target="_blank" rel="noreferrer noopener" className="link inline-block">
            {s.link.label} ↗
          </a>
        )}
        {s.check === "url_live" && <AgentCheck kind="url_live" placeholder="https://yourcompany.com/privacy" />}
        {s.check === "redirect_uri" && <AgentCheck kind="redirect_uri" placeholder="Redirect URI" initial={COMPOSIO_REDIRECT_URI} />}
        {s.check === "oauth_discovery" && <AgentCheck kind="oauth_discovery" placeholder="Provider domain" initial={view.guide.app.website ?? ""} />}
      </div>
    ),
  }));
  return (
    <section>
      <H2 id="setup" aside={`${view.steps.length} steps · ${view.effort.label} hands-on`}>
        Setup steps
      </H2>
      {view.prerequisites.length > 0 && (
        <div className="mb-6 rounded-lg border border-border p-4">
          <div className="mb-2 text-sm font-semibold text-fg">Before you start</div>
          <ul className="space-y-1.5 text-sm">
            {view.prerequisites.map((p) => (
              <li key={p.id} className="text-fg-muted">
                <span className="font-medium text-fg">{p.item.replace(/[.\s]+$/, "")}.</span> <Rich text={p.why} />
                <Cite ids={p.evidence} index={index} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <StepList storageKey={storageKey} items={items} heading={`${view.guide.app.name}: ${view.path.label}`} />
    </section>
  );
}

/* ---------- Composio wiring ---------- */

export function ComposioWiring({ view, index }: { view: GuideView; index: EvidenceIndex }) {
  return (
    <section>
      <H2 id="composio">Connect to Composio</H2>
      <p className="mb-5 text-sm text-fg-muted">Once you have a client ID and secret, create a custom auth config and use it in your sessions.</p>
      <ol className="space-y-6">
        {view.wiring.map((w, i) => {
          const code = w.paste?.filter((p) => p.label === "TypeScript" || p.label === "Python") ?? [];
          const values = w.paste?.filter((p) => !code.includes(p)) ?? [];
          return (
            <li key={w.id} className="grid grid-cols-[1.75rem_1fr] gap-x-3">
              <span className="grid h-7 w-7 place-items-center rounded-full border border-border-strong text-xs font-medium text-fg-muted">{i + 1}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="text-[0.95rem] font-semibold text-fg">{w.title}</h3>
                  <OwnerBadge owner={w.owner} />
                  <Cite ids={w.evidence} index={index} />
                </div>
                <p className="mt-1 text-sm text-fg-muted">{w.detail}</p>
                <div className="mt-2 space-y-2">
                  {values.map((p) => (
                    <CodeBlock key={p.label} label={p.label} code={p.value} />
                  ))}
                  {code.length > 0 && <Tabs tabs={code.map((p) => ({ label: p.label, content: <CodeBlock code={p.value} /> }))} />}
                  {w.id === "wire-redirect" && <AgentCheck kind="redirect_uri" placeholder="Paste the redirect URI you registered" initial={COMPOSIO_REDIRECT_URI} />}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {view.guide.composio_notes.length > 0 && (
        <Callout tone="neutral" title="Composio notes for this app">
          <ul className="list-disc space-y-1 pl-5">
            {view.guide.composio_notes.map((n, i) => (
              <li key={i}>
                <Rich text={n.text} />
                {n.evidence.length > 0 && <Cite ids={n.evidence} index={index} />}
              </li>
            ))}
          </ul>
        </Callout>
      )}
    </section>
  );
}

/* ---------- Approval and timeline ---------- */

function chains(gates: Gate[]): Gate[][] {
  const byId = new Map(gates.map((g) => [g.id, g]));
  const kids = new Map<string, Gate[]>();
  for (const g of gates) if (g.after && byId.has(g.after)) kids.set(g.after, [...(kids.get(g.after) ?? []), g]);
  const out: Gate[][] = [];
  const walk = (g: Gate, chain: Gate[], depth: number) => {
    const next = [...chain, g];
    const ch = depth > 10 ? [] : (kids.get(g.id) ?? []);
    if (!ch.length) out.push(next);
    else ch.forEach((c, i) => walk(c, i === 0 ? next : [g], depth + 1));
  };
  for (const g of gates) if (!g.after || !byId.has(g.after)) walk(g, [], 0);
  return out;
}

function GateSequence({ gates }: { gates: Gate[] }) {
  const lines = chains(gates);
  return (
    <figure className="my-4 space-y-2 rounded-lg border border-border bg-bg-subtle p-3">
      {lines.map((line, li) => (
        <div key={li} className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-xs text-fg-subtle">{li === 0 ? "Day 0" : "In parallel"}</span>
          {line.map((g) => (
            <span key={g.id} className="flex items-center gap-1.5">
              <span aria-hidden className="text-fg-subtle">
                →
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1">
                <LevelBadge level={GATE_LEVELS[g.type] as 2} name={false} />
                <span className="text-fg">{g.title}</span>
                <span className="text-xs text-fg-subtle">{formatGateWait(g.wait).replace("business days", "bd").replace("No published timeline", "no timeline")}</span>
              </span>
            </span>
          ))}
          {line.some((g) => g.recurring) && <span className="text-xs text-fg-subtle">→ repeats yearly</span>}
        </div>
      ))}
      <figcaption className="pt-1 text-xs text-fg-subtle">Each arrow waits for the previous step. Separate lines run at the same time.</figcaption>
    </figure>
  );
}

export function Approval({ view, index, base }: { view: GuideView; index: EvidenceIndex; base: string }) {
  const { path } = view;
  return (
    <section>
      <H2 id="approval" aside={view.wait.label}>
        Approval and timeline
      </H2>
      <p className="text-sm text-fg-muted">{path.summary}</p>
      {path.gates.length === 0 ? (
        <Callout tone="ok" title="No approval needed on this path">
          Once the app is registered and connected to Composio, you can launch the same day.
        </Callout>
      ) : (
        <>
          <GateSequence gates={path.gates} />
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="table">
              <thead>
                <tr>
                  <th>Gate</th>
                  <th>Level</th>
                  <th>Wait</th>
                  <th>Triggered by</th>
                  <th>How to avoid</th>
                </tr>
              </thead>
              <tbody>
                {path.gates.map((g) => (
                  <tr key={g.id}>
                    <td className="strong min-w-[9rem]">
                      {g.title}
                      {g.recurring && <div className="text-xs font-normal text-fg-subtle">Every year</div>}
                    </td>
                    <td>
                      <LevelBadge level={GATE_LEVELS[g.type] as 2} name={false} />
                    </td>
                    <td className="min-w-[8rem]">
                      {formatGateWait(g.wait)}
                      <Cite ids={g.evidence} index={index} />
                      {g.wait?.note && <div className="mt-0.5 text-xs text-fg-subtle">{g.wait.note}</div>}
                    </td>
                    <td>
                      <Rich text={g.trigger} />
                    </td>
                    <td>{g.avoid ? <Rich text={g.avoid} /> : <span className="text-fg-subtle">Unavoidable on this path</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {path.badges.length > 0 && (
        <>
          <h3 id="watch-for" className="mb-2 mt-8 scroll-mt-20 text-base font-semibold text-fg">
            Also watch for
          </h3>
          <ul className="space-y-2 text-sm">
            {path.badges.map((b, i) => (
              <li key={i} className="grid gap-1 sm:grid-cols-[7.5rem_1fr]">
                <span>
                  <Badge tone={b.kind === "cost" ? "warn" : b.kind === "after_launch" ? "bad" : b.kind === "customer_admin" ? "accent" : "neutral"}>{BADGE_KIND[b.kind]}</Badge>
                </span>
                <span className="text-fg-muted">
                  {b.text}
                  <Cite ids={b.evidence} index={index} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {view.whileYouWait.length > 0 && (
        <>
          <h3 className="mb-2 mt-8 text-base font-semibold text-fg">While you wait</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
            {view.whileYouWait.map((w, i) => (
              <li key={i}>
                <Rich text={w.text} />
              </li>
            ))}
          </ul>
        </>
      )}

      {view.summaries.length > 1 && (
        <>
          <h3 className="mb-2 mt-8 text-base font-semibold text-fg">Compare paths</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="table">
              <thead>
                <tr>
                  <th>Path</th>
                  <th>For</th>
                  <th>Level</th>
                  <th>Calendar wait</th>
                  <th>Hands-on</th>
                </tr>
              </thead>
              <tbody>
                {view.summaries.map((s) => {
                  const current = s.path.id === view.path.id;
                  return (
                    <tr key={s.path.id} className={current ? "bg-accent-subtle" : ""}>
                      <td className="strong">
                        {current ? (
                          s.path.label
                        ) : (
                          <Link href={`${base}?${intakeQuery(view.intake, { path: s.path.id })}#approval`} scroll={false} className="link">
                            {s.path.label}
                          </Link>
                        )}
                        {s.path.composio_default && <div className="text-xs font-normal text-fg-subtle">Where Composio&apos;s default scopes land</div>}
                      </td>
                      <td>{s.path.applies.audience?.map((a) => AUDIENCE_LABEL[a]).join(", ") ?? "Anyone"}</td>
                      <td>
                        <LevelBadge level={s.level.value} unconfirmed={s.level.unconfirmed} name={false} />
                      </td>
                      <td className="min-w-[7rem]">{s.wait.label}</td>
                      <td className="whitespace-nowrap">{s.effort.label.replace("about ", "~")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {view.scopeAdvice.warning && (
        <Callout tone="warn" title="Composio's default scopes">
          {view.scopeAdvice.warning}
        </Callout>
      )}
    </section>
  );
}

/* ---------- Troubleshooting ---------- */

export function Troubleshooting({ view, index }: { view: GuideView; index: EvidenceIndex }) {
  if (!view.blockers.length) return null;
  return (
    <section>
      <H2 id="troubleshooting">Troubleshooting</H2>
      {view.blockers.map((b) => (
        <Disclosure key={b.id} title={b.symptom}>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[7rem_1fr]">
            <dt className="text-fg-subtle">Cause</dt>
            <dd className="text-fg-muted">
              <Rich text={b.cause} />
              <Cite ids={b.evidence} index={index} />
            </dd>
            <dt className="text-fg-subtle">Fix now</dt>
            <dd className="text-fg-muted">
              <Rich text={b.fix_now} />
            </dd>
            <dt className="text-fg-subtle">Fix properly</dt>
            <dd className="text-fg-muted">
              <Rich text={b.fix_properly} />
            </dd>
            <dt className="text-fg-subtle">Escalate</dt>
            <dd className="text-fg-muted">
              {b.escalate.how}{" "}
              {b.escalate.url && (
                <a href={b.escalate.url} target="_blank" rel="noreferrer noopener" className="link">
                  Open ↗
                </a>
              )}
            </dd>
          </dl>
          {b.escalate.draft && <CodeBlock className="mt-3" label="Message to send (drafted)" code={b.escalate.draft} />}
        </Disclosure>
      ))}
    </section>
  );
}

/* ---------- Reference (collapsed) ---------- */

const TIER: Record<ScopeTier, { label: string; tone: "ok" | "warn" | "bad" | "accent" | "neutral" }> = {
  no_review: { label: "No review", tone: "ok" },
  sensitive: { label: "Sensitive", tone: "warn" },
  restricted: { label: "Restricted", tone: "bad" },
  admin_consent: { label: "Admin consent", tone: "accent" },
  product_access: { label: "Needs approval", tone: "warn" },
  unknown: { label: "Unknown", tone: "neutral" },
};

const ANSWER_TONE = { yes: "ok", no: "neutral", partly: "warn", unknown: "bad" } as const;

export function Reference({ view, index }: { view: GuideView; index: EvidenceIndex }) {
  const pathSet = new Set(view.path.scopes);
  const defaults = new Set(view.scopeAdvice.composioDefaults.map((d) => d.scope));
  const scopeRows = [...new Set([...view.path.scopes, ...defaults])].map((s) => {
    const c = view.guide.scopes.find((x) => x.scope === s);
    return { scope: s, tier: c?.tier ?? ("unknown" as ScopeTier), what: c?.what ?? "", evidence: c?.evidence ?? [] };
  });
  return (
    <section>
      <H2 id="reference">Reference</H2>
      <p className="mb-4 text-sm text-fg-muted">
        Details behind the numbers above. New to the terms? Read{" "}
        <Link href="/concepts" className="link">
          Concepts
        </Link>
        .
      </p>
      {scopeRows.length > 0 && (
        <Disclosure title="Scopes and review tiers" meta={`${scopeRows.length}`}>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="table">
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>Tier</th>
                  <th>This path</th>
                  <th>Composio default</th>
                </tr>
              </thead>
              <tbody>
                {scopeRows.map((r) => (
                  <tr key={r.scope}>
                    <td>
                      <code className="font-mono text-xs text-fg">{r.scope}</code>
                      {r.what && <div className="mt-0.5 text-xs text-fg-subtle">{r.what}</div>}
                    </td>
                    <td>
                      <Badge tone={TIER[r.tier].tone}>{TIER[r.tier].label}</Badge>
                      {r.evidence.length > 0 && <Cite ids={r.evidence} index={index} />}
                    </td>
                    <td>{pathSet.has(r.scope) ? "Yes" : ""}</td>
                    <td>{defaults.has(r.scope) ? "Yes" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      )}
      <Disclosure title="What we checked" meta="11 questions">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="table">
            <tbody>
              {CORE_QUESTIONS.map((q) => {
                const c = view.guide.checks.find((x) => x.q === q.id);
                return (
                  <tr key={q.id}>
                    <td className="strong w-[45%]">{q.text}</td>
                    <td>
                      <Badge tone={ANSWER_TONE[c?.answer ?? "unknown"]}>{c?.answer ?? "not checked"}</Badge> <Rich text={c?.detail ?? ""} />
                      {c && c.evidence.length > 0 && <Cite ids={c.evidence} index={index} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Disclosure>
      {view.unknowns.length > 0 && (
        <Disclosure title="Open questions" meta={`${view.unknowns.length}`}>
          <ul className="space-y-3">
            {view.unknowns.map((u, i) => (
              <li key={i}>
                <div className="font-medium text-fg">
                  {u.question} {u.level_deciding && <Badge tone="bad">Could change the level</Badge>}
                </div>
                <div className="text-fg-muted">{u.why}</div>
                <div className="text-fg-subtle">How to find out: {u.how_to_find_out}</div>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      <Disclosure title="Sources" meta={`${view.evidenceList.length}`} id="sources">
        <ol className="space-y-3">
          {view.evidenceList.map((e, i) => (
            <li key={e.id} id={`src-${e.id}`} className="scroll-mt-24 rounded-md p-1 target:bg-accent-subtle">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs text-fg-subtle">[{i + 1}]</span>
                <Badge tone={e.label === "tested" ? "ok" : e.label === "official" ? "neutral" : e.label === "reported" ? "warn" : "bad"}>{e.label}</Badge>
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer noopener" className="link">
                    {e.title}
                  </a>
                ) : (
                  <span className="text-fg">{e.title}</span>
                )}
                <span className="text-xs text-fg-subtle">
                  {e.publisher ? `${e.publisher} · ` : ""}read {e.retrieved}
                  {e.verification?.status === "verified" ? ` · re-checked ${e.verification.checked}` : ""}
                </span>
              </div>
              {e.excerpt && <p className="mt-1 border-l-2 border-border pl-3 text-xs text-fg-muted">“{e.excerpt}”</p>}
              {e.note && <p className="mt-1 text-xs text-fg-subtle">{e.note}</p>}
              {e.corrected && (
                <p className="mt-1 text-xs text-bad">
                  Changed from {e.corrected.from}: {e.corrected.reason}.
                </p>
              )}
            </li>
          ))}
        </ol>
      </Disclosure>
      <Disclosure title="How levels, labels and owners work">
        <ul className="space-y-1.5 text-fg-muted">
          {([1, 2, 3, 4] as const).map((l) => (
            <li key={l}>
              <LevelBadge level={l} /> {LEVEL_MEANING[l]}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-fg-muted">
          Citations show a number; Official sources are the default. Tested, Reported and Unverified are named next to the number. Hands-on effort is our estimate; calendar wait comes only from sources.{" "}
          <Link href="/concepts" className="link">
            Full explanation
          </Link>
          .
        </p>
      </Disclosure>
    </section>
  );
}

/** The whole guide body, in implementation order. */
export function GuideBody({ view, base, storageKey }: { view: GuideView; base: string; storageKey: string }) {
  const index = evidenceIndex(view);
  return (
    <>
      <OpenOnHash />
      <div className="space-y-4">
        <GuideSetup view={view} base={base} />
        {view.choice.fallback && <Callout tone="neutral">No path exactly matches your setup, so the recommended path is shown. Pick another under Path.</Callout>}
        <Summary view={view} index={index} />
      </div>
      <SetupSteps view={view} index={index} storageKey={storageKey} />
      <ComposioWiring view={view} index={index} />
      <Approval view={view} index={index} base={base} />
      <Troubleshooting view={view} index={index} />
      <Reference view={view} index={index} />
    </>
  );
}
