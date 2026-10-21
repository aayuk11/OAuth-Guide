import {
  CORE_QUESTIONS,
  GATE_LEVELS,
  STEP_MINUTES,
  type Evidence,
  type EvidenceLabel,
  type Gate,
  type Guide,
  type GuidePath,
  type Step,
  type Wait,
} from "./schema";

/** Deterministic scoring. The model never sets these numbers; code computes them from gates, steps and evidence. */

export const LEVEL_NAMES: Record<1 | 2 | 3 | 4, string> = {
  1: "Self-serve",
  2: "Light check",
  3: "Reviewed",
  4: "Heavy",
};

export const LEVEL_MEANING: Record<1 | 2 | 3 | 4, string> = {
  1: "No review of any kind",
  2: "Automated or light human check, usually under a week",
  3: "Human review of your app, a product-access application or a listing",
  4: "Third-party security assessment, or review that recurs every year",
};

const LABEL_RANK: Record<EvidenceLabel, number> = { tested: 3, official: 2, reported: 1, unverified: 0 };

export function strongestLabel(ids: string[], evidence: Map<string, Evidence>): EvidenceLabel {
  let best: EvidenceLabel = "unverified";
  for (const id of ids) {
    const e = evidence.get(id);
    if (e && LABEL_RANK[e.label] > LABEL_RANK[best]) best = e.label;
  }
  return best;
}

export function weakestLabel(labels: EvidenceLabel[]): EvidenceLabel | null {
  if (labels.length === 0) return null;
  return labels.reduce((a, b) => (LABEL_RANK[a] <= LABEL_RANK[b] ? a : b));
}

export function appliesToPath(paths: string[], pathId: string): boolean {
  return paths.includes("*") || paths.includes(pathId);
}

/* ---------- Level ---------- */

export interface LevelResult {
  value: 1 | 2 | 3 | 4;
  name: string;
  unconfirmed: boolean;
  drivers: Gate[];
  why: string;
}

export function levelDecidingUnknowns(guide: Guide, path: GuidePath): string[] {
  const out: string[] = [];
  for (const u of guide.unknowns) if (u.level_deciding && appliesToPath(u.paths, path.id)) out.push(u.question);
  const deciding = new Set<string>(CORE_QUESTIONS.filter((q) => q.levelDeciding).map((q) => q.id));
  for (const c of guide.checks) if (deciding.has(c.q) && c.answer === "unknown") out.push(CORE_QUESTIONS.find((q) => q.id === c.q)!.text);
  return out;
}

export function computeLevel(guide: Guide, path: GuidePath): LevelResult {
  let value: 1 | 2 | 3 | 4 = 1;
  for (const g of path.gates) value = Math.max(value, GATE_LEVELS[g.type]) as 1 | 2 | 3 | 4;
  const drivers = path.gates.filter((g) => GATE_LEVELS[g.type] === value);
  const unknowns = levelDecidingUnknowns(guide, path);
  const why =
    value === 1
      ? "No review or verification gate applies on this path."
      : `Set by ${drivers.map((d) => d.title.toLowerCase()).join(" and ")}.`;
  return { value, name: LEVEL_NAMES[value], unconfirmed: unknowns.length > 0, drivers, why };
}

/* ---------- Wait (calendar) ---------- */

export function toBusinessDays(n: number, unit: Wait["unit"]): number {
  if (unit === "business_days") return n;
  if (unit === "weeks") return n * 5;
  return Math.ceil((n * 5) / 7);
}

export interface WaitResult {
  /** Business days; null when nothing is known. */
  min: number | null;
  max: number | null;
  openEnded: boolean;
  recurring: boolean;
  sameDay: boolean;
  label: string;
  gatesWithoutTimeline: Gate[];
  conflict: boolean;
  basis: EvidenceLabel | null;
}

export function formatBusinessDays(min: number, max: number): string {
  const fmt = (lo: number, hi: number, unit: string) => (lo === hi ? `${lo} ${unit}` : `${lo}–${hi} ${unit}`);
  if (max >= 20) {
    const lo = Math.max(1, Math.round(min / 5));
    const hi = Math.max(lo, Math.round(max / 5));
    return fmt(lo, hi, hi === 1 ? "week" : "weeks");
  }
  return fmt(min, max, max === 1 ? "business day" : "business days");
}

/**
 * Critical path over the path's gates: a gate with `after` starts when that gate finishes;
 * other gates run in parallel. Gates with no published timeline make the total open-ended.
 */
export function computeWait(path: GuidePath, evidence: Map<string, Evidence>): WaitResult {
  const gates = path.gates;
  if (gates.length === 0) {
    return { min: 0, max: 0, openEnded: false, recurring: false, sameDay: true, label: "Same day", gatesWithoutTimeline: [], conflict: false, basis: null };
  }
  const byId = new Map(gates.map((g) => [g.id, g]));
  const memo = new Map<string, [number, number]>();
  const visiting = new Set<string>();
  const finish = (g: Gate): [number, number] => {
    if (memo.has(g.id)) return memo.get(g.id)!;
    if (visiting.has(g.id)) return [0, 0]; // cycle guard
    visiting.add(g.id);
    const before = g.after && byId.has(g.after) ? finish(byId.get(g.after)!) : [0, 0];
    const lo = g.wait?.min != null ? toBusinessDays(g.wait.min, g.wait.unit) : g.wait?.max != null ? toBusinessDays(g.wait.max, g.wait.unit) : 0;
    const hi = g.wait?.max != null ? toBusinessDays(g.wait.max, g.wait.unit) : lo;
    const r: [number, number] = [before[0] + lo, before[1] + hi];
    visiting.delete(g.id);
    memo.set(g.id, r);
    return r;
  };
  let min = 0;
  let max = 0;
  for (const g of gates) {
    const [lo, hi] = finish(g);
    min = Math.max(min, lo);
    max = Math.max(max, hi);
  }
  const without = gates.filter((g) => !g.wait || (g.wait.min == null && g.wait.max == null));
  const openEnded = without.length > 0;
  const recurring = gates.some((g) => g.recurring === "yearly");
  const conflict = gates.some((g) => g.evidence.some((id) => (evidence.get(id)?.conflicts_with?.length ?? 0) > 0));
  const labels = gates.filter((g) => g.wait && (g.wait.min != null || g.wait.max != null)).map((g) => strongestLabel(g.evidence, evidence));
  const basis = weakestLabel(labels);

  let label: string;
  if (max === 0 && openEnded) label = "No published timeline";
  else if (max === 0) label = "Same day";
  else label = formatBusinessDays(min, max) + (openEnded ? "+" : "");
  if (recurring) label += ", then yearly";
  return { min: max === 0 && openEnded ? null : min, max: max === 0 && openEnded ? null : max, openEnded, recurring, sameDay: max === 0 && !openEnded, label, gatesWithoutTimeline: without, conflict, basis };
}

/** One gate's stated wait in words: "3–10 business days", "up to 6 weeks", "2+ weeks". */
export function formatGateWait(w: Wait | null): string {
  if (!w || (w.min == null && w.max == null)) return "No published timeline";
  const unit = w.unit.replace("_", " ");
  if (w.min == null) return `up to ${w.max} ${unit}`;
  if (w.max == null) return `${w.min}+ ${unit}`;
  return w.min === w.max ? `${w.max} ${unit}` : `${w.min}–${w.max} ${unit}`;
}

/* ---------- Effort (hands-on, our estimate) ---------- */

export interface EffortResult {
  minutes: number;
  label: string;
  steps: Step[];
}

export function stepMinutes(s: Step): number {
  return s.minutes ?? STEP_MINUTES[s.type];
}

export function formatMinutes(m: number): string {
  if (m < 60) return `about ${Math.max(5, Math.round(m / 5) * 5)} min`;
  const h = m / 60;
  if (h < 10) return `about ${Math.round(h * 2) / 2} h`.replace(".5 h", "½ h");
  const d = Math.round(h / 8);
  return `about ${d} working day${d === 1 ? "" : "s"}`;
}

export function computeEffort(guide: Guide, path: GuidePath, includeComposioWiring = true): EffortResult {
  const steps = guide.steps.filter((s) => appliesToPath(s.paths, path.id));
  let minutes = steps.reduce((n, s) => n + stepMinutes(s), 0);
  if (includeComposioWiring) minutes += STEP_MINUTES.wire_composio;
  return { minutes, label: formatMinutes(minutes), steps };
}

/* ---------- Confidence ---------- */

export interface ConfidenceResult {
  value: "high" | "medium" | "low";
  reasons: string[];
}

/**
 * High: every gate claim and level-deciding answer is Official or Tested, with no conflicts or unknowns.
 * Medium: everything has a source, but some only Reported, or sources disagree.
 * Low: anything level-deciding is Unverified or unknown, or the guide is partial.
 */
export function computeConfidence(guide: Guide, path: GuidePath, evidence: Map<string, Evidence>): ConfidenceResult {
  const reasons: string[] = [];
  let value: ConfidenceResult["value"] = "high";
  const lower = (to: ConfidenceResult["value"], why: string) => {
    reasons.push(why);
    if (to === "low" || (to === "medium" && value === "high")) value = to;
  };
  if (guide.meta?.partial) lower("low", "Research stopped early; this is a partial guide.");
  if (guide.meta?.app_found === false) lower("low", "The agent could not confirm which app this is.");

  const unknowns = levelDecidingUnknowns(guide, path);
  if (unknowns.length) lower("low", `${unknowns.length} open question${unknowns.length > 1 ? "s" : ""} could change the level.`);

  const deciding = new Set<string>(CORE_QUESTIONS.filter((q) => q.levelDeciding).map((q) => q.id));
  const claims: { what: string; ids: string[] }[] = [
    ...path.gates.map((g) => ({ what: g.title, ids: g.evidence })),
    ...guide.checks.filter((c) => deciding.has(c.q) && c.answer !== "unknown").map((c) => ({ what: c.q, ids: c.evidence })),
  ];
  const labels = claims.map((c) => strongestLabel(c.ids, evidence));
  if (labels.includes("unverified")) lower("low", "Some gate claims have no supporting source (Unverified).");
  else if (labels.includes("reported")) lower("medium", "Some gate claims rest on community reports only.");

  const pathEvidence = new Set(claims.flatMap((c) => c.ids));
  const conflicting = [...pathEvidence].filter((id) => (evidence.get(id)?.conflicts_with?.length ?? 0) > 0);
  if (conflicting.length) lower("medium", "Official sources disagree on at least one number; the guide shows both.");

  if (reasons.length === 0) reasons.push("Every gate claim is backed by the provider's own documentation or our own test.");
  return { value, reasons };
}
