import { createHash } from "node:crypto";
import { CORE_QUESTION_IDS, SCHEMA_VERSION, type Evidence, type Guide, type GuidePath, type Step } from "@/lib/guide/schema";
import type { Toolkit } from "@/lib/catalog";
import type { Draft } from "./draft-schema";
import type { Source } from "@/lib/llm/types";

/** Convert the model's draft into a valid Guide. All ids, references and URLs are produced or checked here. */

const today = () => new Date().toISOString().slice(0, 10);

export function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  // Names with no Latin letters or digits (e.g. 飞书) still need distinct keys.
  return slug || `app-${createHash("sha256").update(s.trim().toLowerCase()).digest("hex").slice(0, 10)}`;
}

function url(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const x = new URL(u.trim());
    return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : null;
  } catch {
    return null;
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function hostname(u: string): string | undefined {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export interface AssembleContext {
  key: string;
  query: string;
  toolkit: Toolkit | null;
  sources: Source[];
  probeEvidence: Evidence[];
  dcrFound: boolean;
  runId: string;
  model: string;
}

export function assembleGuide(draft: Draft, ctx: AssembleContext): Guide {
  const evidence: Evidence[] = [...ctx.probeEvidence];
  const refMap = new Map<string, string>();
  const srcById = new Map(ctx.sources.map((s) => [s.id.toUpperCase(), s]));

  draft.evidence.slice(0, 30).forEach((d, i) => {
    const id = `e${i + 1}`;
    refMap.set(d.ref.trim().toUpperCase(), id);
    const src = srcById.get(d.source.trim().toUpperCase());
    evidence.push({
      id,
      label: src ? d.label : "unverified",
      url: src ? url(src.url) : null,
      title: clip(src?.title || "No source", 160),
      publisher: src ? hostname(src.url) : undefined,
      retrieved: today(),
      excerpt: d.excerpt ? clip(d.excerpt, 400) : undefined,
      note: d.note || (src ? undefined : "The agent cited no source for this claim."),
    });
  });

  let fillerCount = 0;
  const filler = (what: string): string => {
    const id = `e-none-${++fillerCount}`;
    evidence.push({ id, label: "unverified", url: null, title: "No source cited", retrieved: today(), note: `The agent cited no source for: ${clip(what, 120)}` });
    return id;
  };
  const refs = (rs: string[]) => [...new Set(rs.map((r) => refMap.get(r.trim().toUpperCase())).filter((x): x is string => !!x))];
  const refsOrFiller = (rs: string[], what: string) => {
    const r = refs(rs);
    return r.length ? r : [filler(what)];
  };

  // Paths
  const usedIds = new Set<string>();
  const pathIdMap = new Map<string, string>();
  const paths: GuidePath[] = draft.paths.slice(0, 4).map((p, i) => {
    let id = slugify(p.id || p.label) || `path-${i + 1}`;
    while (usedIds.has(id)) id = `${id}-${i + 1}`;
    usedIds.add(id);
    pathIdMap.set(p.id, id);
    const gateIds = new Map<string, string>();
    p.gates.forEach((g, gi) => gateIds.set(g.title, `g${gi + 1}`));
    const start = p.start_here.slice(0, 4).filter((s) => s.action);
    return {
      id,
      label: clip(p.label || `Path ${i + 1}`, 80),
      summary: p.summary || p.label || "Route to production",
      applies: {
        audience: p.audience.length && p.audience.length < 2 ? p.audience : undefined,
        access: p.access.length && p.access.length < 3 ? p.access : undefined,
      },
      recommended: p.recommended || undefined,
      composio_default: (p.uses_composio_defaults && !!ctx.toolkit?.oauth?.scopes.length) || undefined,
      scopes: [...new Set(p.scopes.filter(Boolean))].slice(0, 20),
      gates: p.gates.slice(0, 6).map((g, gi) => ({
        id: `g${gi + 1}`,
        type: g.type,
        title: clip(g.title, 100),
        trigger: g.trigger || "See sources",
        avoid: g.avoid || null,
        wait:
          g.wait_min < 0 && g.wait_max < 0
            ? null
            : { min: g.wait_min < 0 ? null : g.wait_min, max: g.wait_max < 0 ? null : g.wait_max, unit: g.wait_unit, note: g.wait_note || undefined },
        after: g.after_title && gateIds.get(g.after_title) && gateIds.get(g.after_title) !== `g${gi + 1}` ? gateIds.get(g.after_title)! : null,
        recurring: g.yearly ? ("yearly" as const) : null,
        evidence: refsOrFiller(g.evidence, g.title),
      })),
      badges: p.badges.slice(0, 6).map((b) => ({ kind: b.kind, type: b.type || b.kind, text: clip(b.text, 160), evidence: refsOrFiller(b.evidence, b.text) })),
      start_here: start.length ? start : [{ when: "Day 1", action: "Create the app in the provider's developer portal", owner: "you" as const }],
    };
  });
  if (paths.length === 0) {
    paths.push({
      id: "default",
      label: "Standard path",
      summary: "The research did not identify distinct paths.",
      applies: {},
      scopes: [],
      gates: [],
      badges: [],
      start_here: [{ when: "Day 1", action: "Create the app in the provider's developer portal", owner: "you" }],
    });
  }
  if (!paths.some((p) => p.recommended)) paths[0].recommended = true;
  const mapPaths = (ids: string[]) => {
    const out = ids.map((x) => (x === "*" ? "*" : pathIdMap.get(x) ?? (usedIds.has(slugify(x)) ? slugify(x) : null))).filter((x): x is string => !!x);
    return out.length ? [...new Set(out)] : ["*"];
  };

  // Scopes: classify every scope a path uses.
  const scopes = draft.scopes.slice(0, 30).map((s) => ({ scope: s.scope, tier: s.tier, what: clip(s.what, 200), evidence: refs(s.evidence) }));
  const known = new Set(scopes.map((s) => s.scope));
  for (const p of paths) for (const s of p.scopes) if (!known.has(s)) {
    scopes.push({ scope: s, tier: "unknown", what: "", evidence: [] });
    known.add(s);
  }

  const steps: Step[] = draft.steps.slice(0, 12).map((s, i) => ({
    id: `s${i + 1}`,
    title: clip(s.title, 120),
    detail: s.detail || s.title,
    owner: s.owner,
    type: s.type,
    paths: mapPaths(s.path_ids),
    paste: s.paste_label && s.paste_value ? [{ label: clip(s.paste_label, 60), value: clip(s.paste_value, 2000) }] : undefined,
    evidence: refs(s.evidence),
  }));
  if (steps.length === 0)
    steps.push({ id: "s1", title: "Create an OAuth app in the provider's developer portal", detail: "The research did not produce setup steps. Start from the developer portal linked above.", owner: "you", type: "create_app", paths: ["*"], evidence: [] });

  const checks = CORE_QUESTION_IDS.map((q) => {
    const c = draft.checks.find((x) => x.q === q);
    return { q, answer: c?.answer ?? ("unknown" as const), detail: c?.detail ?? "Not established by the research.", evidence: c ? refs(c.evidence) : [] };
  });

  const registration = ctx.dcrFound
    ? draft.oauth.registration === "manual" || draft.oauth.registration === "unknown"
      ? ("manual_or_dcr" as const)
      : draft.oauth.registration
    : draft.oauth.registration;

  return {
    schema_version: SCHEMA_VERSION,
    slug: ctx.key,
    kind: "generated",
    composio_slug: ctx.toolkit?.slug ?? null,
    app: {
      name: clip(draft.app.name || ctx.toolkit?.name || ctx.query, 80),
      provider: clip(draft.app.provider || draft.app.name || ctx.query, 80),
      website: url(draft.app.website),
      developer_portal: url(draft.app.developer_portal),
      docs_url: url(draft.app.docs_url),
      logo: ctx.toolkit?.logo ?? null,
    },
    headline: clip(draft.headline || `What it takes to get a ${draft.app.name || ctx.query} OAuth app ready for production.`, 300),
    oauth: {
      supported: draft.oauth.supported,
      registration,
      notes: draft.oauth.notes.slice(0, 6).map((n) => clip(n, 300)),
      evidence: [...refs(draft.oauth.evidence), ...ctx.probeEvidence.map((e) => e.id)],
    },
    paths,
    scopes,
    prerequisites: draft.prerequisites.slice(0, 8).map((p, i) => ({ id: `p${i + 1}`, item: clip(p.item, 140), why: p.why || p.item, owner: p.owner, paths: mapPaths(p.path_ids), evidence: refs(p.evidence) })),
    steps,
    while_you_wait: draft.while_you_wait.slice(0, 6).filter(Boolean).map((t) => ({ text: clip(t, 300), paths: ["*"] })),
    blockers: draft.blockers.slice(0, 5).map((b, i) => ({
      id: `b${i + 1}`,
      symptom: clip(b.symptom, 200),
      cause: b.cause || "Unknown",
      fix_now: b.fix_now || "See the provider's documentation.",
      fix_properly: b.fix_properly || b.fix_now || "See the provider's documentation.",
      escalate: { channel: b.escalate_channel, url: url(b.escalate_url), how: b.escalate_how || "Contact the provider's developer support.", draft: b.draft_message || undefined },
      paths: ["*"],
      evidence: refs(b.evidence),
    })),
    checks,
    unknowns: draft.unknowns.slice(0, 6).map((u) => ({ question: clip(u.question, 200), why: u.why || "It affects the plan.", how_to_find_out: u.how_to_find_out || "Ask the provider's developer support.", level_deciding: u.level_deciding, paths: ["*"] })),
    composio_notes: draft.composio_notes.slice(0, 4).filter(Boolean).map((t) => ({ text: clip(t, 300), evidence: [] })),
    evidence,
    last_verified: today(),
    meta: {
      generated_at: new Date().toISOString(),
      model: ctx.model,
      run_id: ctx.runId,
      query: ctx.query,
      app_found: draft.app_found,
    },
  };
}

/** When research or extraction fails, keep everything that was found in an honest partial guide. */
export function partialGuide(args: AssembleContext & { reason: string; notes: string; oauthSupported: "yes" | "no" | "unknown" }): Guide {
  const evidence: Evidence[] = [...args.probeEvidence];
  args.sources
    .filter((s) => s.fetched)
    .slice(0, 12)
    .forEach((s, i) =>
      evidence.push({
        id: `src${i + 1}`,
        label: "unverified",
        url: url(s.url),
        title: clip(s.title, 160),
        retrieved: today(),
        note: "Read by the agent; not yet turned into checked claims.",
      }),
    );
  if (evidence.length === 0)
    evidence.push({ id: "none", label: "unverified", url: null, title: "No sources found", retrieved: today(), note: args.reason });
  const name = args.toolkit?.name ?? args.query;
  return {
    schema_version: SCHEMA_VERSION,
    slug: args.key,
    kind: "generated",
    composio_slug: args.toolkit?.slug ?? null,
    app: { name: clip(name, 80), provider: clip(name, 80), website: null, developer_portal: null, docs_url: null, logo: args.toolkit?.logo ?? null },
    headline: `Research for ${name} did not finish, so this guide only lists what was found. Retry to complete it.`,
    oauth: { supported: args.oauthSupported, registration: args.dcrFound ? "manual_or_dcr" : "unknown", notes: [], evidence: args.probeEvidence.map((e) => e.id) },
    paths: [
      {
        id: "unknown",
        label: "Path not yet determined",
        summary: "The research stopped before the paths to production were established.",
        applies: {},
        scopes: [],
        gates: [],
        badges: [],
        start_here: [{ when: "Now", action: "Retry the research, or read the sources the agent found", owner: "you" }],
      },
    ],
    scopes: [],
    prerequisites: [],
    steps: [
      { id: "s1", title: `Create an OAuth app in ${name}'s developer portal`, detail: "The research did not finish, so exact steps are not available yet.", owner: "you", type: "create_app", paths: ["*"], evidence: [] },
    ],
    while_you_wait: [],
    blockers: [],
    checks: CORE_QUESTION_IDS.map((q) => ({ q, answer: "unknown" as const, detail: "Not established before the research stopped.", evidence: [] })),
    unknowns: [
      { question: "Does production use need a review, verification or security assessment?", why: "This decides the difficulty level and the wait.", how_to_find_out: "Retry the research, or read the provider's app review and OAuth docs.", level_deciding: true, paths: ["*"] },
    ],
    composio_notes: [],
    evidence,
    last_verified: today(),
    meta: {
      generated_at: new Date().toISOString(),
      model: args.model,
      run_id: args.runId,
      query: args.query,
      partial: true,
      partial_reason: args.reason,
      research_notes: args.notes ? clip(args.notes, 12000) : undefined,
    },
  };
}
