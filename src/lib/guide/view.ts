import { COMPOSIO_REDIRECT_URI, getToolkit, type Toolkit } from "@/lib/catalog";
import { COMPOSIO_EVIDENCE, toolkitDataEvidence } from "@/lib/composio-evidence";
import { choosePath, type Intake, type PathChoice } from "./intake";
import {
  appliesToPath,
  computeConfidence,
  computeEffort,
  computeLevel,
  computeWait,
  type ConfidenceResult,
  type EffortResult,
  type LevelResult,
  type WaitResult,
} from "./scoring";
import { GATE_LEVELS, type Evidence, type Guide, type GuidePath, type Scope, type ScopeTier, type Step } from "./schema";
import { computeVerdict, type Verdict } from "./verdict";

export interface PathSummary {
  path: GuidePath;
  level: LevelResult;
  wait: WaitResult;
  effort: EffortResult;
}

export interface ScopeAdvice {
  pathScopes: Scope[];
  composioDefaults: { scope: string; tier: ScopeTier; what: string; evidence: string[] }[];
  worstDefaultTier: ScopeTier | null;
  defaultPath: GuidePath | null;
  warning: string | null;
}

export interface WiringStep {
  id: string;
  title: string;
  detail: string;
  owner: Step["owner"];
  paste?: { label: string; value: string }[];
  evidence: string[];
}

export interface GuideView {
  guide: Guide;
  toolkit: Toolkit | null;
  intake: Intake;
  choice: PathChoice;
  path: GuidePath;
  level: LevelResult;
  wait: WaitResult;
  effort: EffortResult;
  confidence: ConfidenceResult;
  verdict: Verdict;
  summaries: PathSummary[];
  prerequisites: Guide["prerequisites"];
  steps: Guide["steps"];
  blockers: Guide["blockers"];
  whileYouWait: Guide["while_you_wait"];
  unknowns: Guide["unknowns"];
  scopeAdvice: ScopeAdvice;
  wiring: WiringStep[];
  evidence: Map<string, Evidence>;
  evidenceList: Evidence[];
}

const TIER_RANK: Record<ScopeTier, number> = { restricted: 5, sensitive: 4, admin_consent: 3, product_access: 3, unknown: 1, no_review: 0 };

export function evidenceMap(guide: Guide, toolkit: Toolkit | null): Map<string, Evidence> {
  const m = new Map<string, Evidence>();
  for (const e of COMPOSIO_EVIDENCE) m.set(e.id, e);
  if (toolkit) m.set("cx-data", toolkitDataEvidence(toolkit));
  for (const e of guide.evidence) m.set(e.id, e);
  return m;
}

export function scopeAdvice(guide: Guide, path: GuidePath, toolkit: Toolkit | null): ScopeAdvice {
  const byScope = new Map(guide.scopes.map((s) => [s.scope, s]));
  const pathScopes = path.scopes.map((s) => byScope.get(s)).filter((s): s is Scope => !!s);
  const defaults = (toolkit?.oauth?.scopes ?? []).map((s) => {
    const c = byScope.get(s);
    return { scope: s, tier: c?.tier ?? ("unknown" as ScopeTier), what: c?.what ?? "", evidence: c?.evidence ?? [] };
  });
  const worst = defaults.length ? defaults.reduce((a, b) => (TIER_RANK[b.tier] > TIER_RANK[a.tier] ? b : a)).tier : null;
  const defaultPath = guide.paths.find((p) => p.composio_default) ?? null;
  let warning: string | null = null;
  // Only warn when the default-scope path serves the same audience (e.g. Google internal apps are exempt from review).
  const sameAudience = (a: GuidePath, b: GuidePath) => !a.applies.audience || !b.applies.audience || a.applies.audience.some((x) => b.applies.audience!.includes(x));
  if (defaultPath && defaultPath.id !== path.id && sameAudience(defaultPath, path)) {
    const dl = Math.max(1, ...defaultPath.gates.map((g) => GATE_LEVELS[g.type]));
    const pl = Math.max(1, ...path.gates.map((g) => GATE_LEVELS[g.type]));
    if (dl > pl)
      warning = `Composio's default scopes for this toolkit match the "${defaultPath.label}" path (Level ${dl}). If you copy them into your own app you take on that review. Request only the scopes this path needs.`;
  } else if (defaultPath && defaultPath.id === path.id && worst && TIER_RANK[worst] >= 3) {
    warning = `This is the path Composio's default scopes put you on. If you need less access, a narrower path may be faster.`;
  }
  return { pathScopes, composioDefaults: defaults, worstDefaultTier: worst, defaultPath, warning };
}

export function wiringSteps(toolkit: Toolkit | null, appName: string): WiringStep[] {
  const legacyDefault = toolkit?.oauth?.redirect && toolkit.oauth.redirect !== COMPOSIO_REDIRECT_URI ? toolkit.oauth.redirect : null;
  const slug = toolkit?.slug ?? "your_toolkit";
  const steps: WiringStep[] = [
    {
      id: "wire-redirect",
      title: "Make the redirect URI match exactly in both places",
      detail: `Register Composio's callback in ${appName}'s developer console and set the same value in your Composio auth config. A mismatch is the most common setup error.${
        legacyDefault
          ? ` This toolkit's default is still Composio's legacy endpoint: if you leave the auth config's redirect field at its default, register that one instead.`
          : ""
      }`,
      owner: "you",
      paste: [
        { label: "Redirect URI (Composio callback)", value: COMPOSIO_REDIRECT_URI },
        ...(legacyDefault ? [{ label: "Toolkit default (legacy, still supported)", value: legacyDefault }] : []),
      ],
      evidence: ["cx-redirect", "cx-redirect-v3"],
    },
    {
      id: "wire-auth-config",
      title: "Create a custom auth config in Composio",
      detail: `Composio dashboard → Create Auth Config → ${toolkit?.name ?? appName} → OAuth2 → paste your client ID and client secret${
        toolkit?.oauth?.extra_config.length ? `, plus ${toolkit.oauth.extra_config.map((f) => f.label).join(", ")}` : ""
      }. Set scopes to the ones your path needs, not the defaults. Copy the auth config ID (ac_…).`,
      owner: "you",
      evidence: ["cx-byo-required"],
    },
    {
      id: "wire-session",
      title: "Use the auth config ID in your sessions",
      detail: "Creating the auth config is not enough: pass its ID when you create a session. Toolkits you leave out keep using Composio's managed auth.",
      owner: "agent_drafts",
      paste: [
        {
          label: "TypeScript",
          value: `const session = await composio.create("user_123", {\n  authConfigs: { ${slug}: "ac_your_config_id" },\n});`,
        },
        {
          label: "Python",
          value: `session = composio.create(\n    user_id="user_123",\n    auth_configs={"${slug}": "ac_your_config_id"},\n)`,
        },
      ],
      evidence: ["cx-session"],
    },
  ];
  const required = toolkit?.oauth?.connection_fields.filter((f) => f.required) ?? [];
  if (required.length)
    steps.push({
      id: "wire-connection-fields",
      title: `Collect ${required.map((f) => f.label).join(" and ")} from each user`,
      detail: `Each connection needs ${required.map((f) => `${f.label}${f.description ? ` (${f.description.replace(/\.$/, "")})` : ""}`).join("; ")}. Ask for it in your onboarding before sending the Connect Link.`,
      owner: "you",
      evidence: ["cx-data"],
    });
  steps.push({
    id: "wire-reconnect",
    title: "Plan the switch for existing users",
    detail: "Switching to your own auth config affects new connections only. Users connected through Composio's managed app keep that connection until they re-authenticate, so prompt them to reconnect.",
    owner: "you",
    evidence: ["cx-reconnect"],
  });
  return steps;
}

/** Compact summary for cards and lists: level range across paths and the default verdict. */
export function summarizeGuide(guide: Guide, intake?: Intake) {
  const toolkit = getToolkit(guide.composio_slug);
  const evidence = evidenceMap(guide, toolkit);
  const levels = guide.paths.map((p) => computeLevel(guide, p).value);
  const waits = guide.paths.map((p) => ({ path: p, wait: computeWait(p, evidence), level: computeLevel(guide, p).value }));
  const slowest = waits.reduce((a, b) => (b.level > a.level || (b.level === a.level && (b.wait.max ?? 0) > (a.wait.max ?? 0)) ? b : a));
  const i = intake ?? guide.default_intake ?? { audience: "external" as const, access: "read" as const, brand: true };
  return {
    minLevel: Math.min(...levels) as 1 | 2 | 3 | 4,
    maxLevel: Math.max(...levels) as 1 | 2 | 3 | 4,
    slowest,
    verdict: computeVerdict({ toolkit, guide, intake: i, appName: guide.app.name }),
    toolkit,
  };
}

export function buildView(guide: Guide, intake: Intake, requestedPath?: string | null): GuideView {
  const toolkit = getToolkit(guide.composio_slug);
  const evidence = evidenceMap(guide, toolkit);
  const choice = choosePath(guide, intake, requestedPath);
  const path = choice.selected;
  const verdict = computeVerdict({ toolkit, guide, intake, appName: guide.app.name });
  const summaries = guide.paths.map((p) => ({
    path: p,
    level: computeLevel(guide, p),
    wait: computeWait(p, evidence),
    effort: computeEffort(guide, p),
  }));
  const current = summaries.find((s) => s.path.id === path.id)!;
  const used = new Set<string>();
  const add = (ids: string[]) => ids.forEach((i) => used.add(i));
  const prerequisites = guide.prerequisites.filter((x) => appliesToPath(x.paths, path.id));
  const steps = guide.steps.filter((x) => appliesToPath(x.paths, path.id));
  const blockers = guide.blockers.filter((x) => appliesToPath(x.paths, path.id));
  const wiring = wiringSteps(toolkit, guide.app.name);
  add(guide.oauth.evidence);
  path.gates.forEach((g) => add(g.evidence));
  path.badges.forEach((b) => add(b.evidence));
  prerequisites.forEach((x) => add(x.evidence));
  steps.forEach((x) => add(x.evidence));
  blockers.forEach((x) => add(x.evidence));
  guide.checks.forEach((x) => add(x.evidence));
  guide.composio_notes.forEach((x) => add(x.evidence));
  guide.scopes.forEach((x) => add(x.evidence));
  verdict.reasons.forEach((r) => add(r.evidence ?? []));
  wiring.forEach((w) => add(w.evidence));
  guide.evidence.forEach((e) => used.add(e.id));
  const evidenceList = [...used].map((id) => evidence.get(id)).filter((e): e is Evidence => !!e);

  return {
    guide,
    toolkit,
    intake,
    choice,
    path,
    level: current.level,
    wait: current.wait,
    effort: current.effort,
    confidence: computeConfidence(guide, path, evidence),
    verdict,
    summaries,
    prerequisites,
    steps,
    blockers,
    whileYouWait: guide.while_you_wait.filter((x) => appliesToPath(x.paths, path.id)),
    unknowns: guide.unknowns.filter((x) => appliesToPath(x.paths, path.id)),
    scopeAdvice: scopeAdvice(guide, path, toolkit),
    wiring,
    evidence,
    evidenceList,
  };
}
