import { ACCESS_LEVELS, AUDIENCES, type Access, type Audience, type Guide, type GuidePath } from "./schema";

/** The three quick questions. They live in the URL so a shared link keeps the reader's context. */
export interface Intake {
  audience: Audience;
  access: Access;
  brand: boolean;
}

export const DEFAULT_INTAKE: Intake = { audience: "external", access: "read", brand: true };

type Params = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseIntake(params: Params, guide?: Guide | null): Intake {
  const base = guide?.default_intake ?? DEFAULT_INTAKE;
  const a = first(params.audience);
  const x = first(params.access);
  const b = first(params.brand);
  return {
    audience: (AUDIENCES as readonly string[]).includes(a ?? "") ? (a as Audience) : base.audience,
    access: (ACCESS_LEVELS as readonly string[]).includes(x ?? "") ? (x as Access) : base.access,
    brand: b === "yes" ? true : b === "no" ? false : base.brand,
  };
}

export function intakeQuery(i: Intake, extra: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams({ audience: i.audience, access: i.access, brand: i.brand ? "yes" : "no" });
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
}

export function pathMatches(p: GuidePath, i: Intake): boolean {
  const aud = !p.applies.audience || p.applies.audience.includes(i.audience);
  const acc = !p.applies.access || p.applies.access.includes(i.access);
  return aud && acc;
}

export interface PathChoice {
  selected: GuidePath;
  matching: GuidePath[];
  others: GuidePath[];
  /** True when no path matched the answers and we fell back to the recommended one. */
  fallback: boolean;
  /** True when the reader picked the path explicitly. */
  explicit: boolean;
}

export function choosePath(guide: Guide, intake: Intake, requested?: string | null): PathChoice {
  const matching = guide.paths.filter((p) => pathMatches(p, intake));
  const others = guide.paths.filter((p) => !matching.includes(p));
  const explicitPath = requested ? guide.paths.find((p) => p.id === requested) : undefined;
  if (explicitPath) return { selected: explicitPath, matching, others, fallback: false, explicit: true };
  const pool = matching.length ? matching : guide.paths;
  const selected = pool.find((p) => p.recommended) ?? pool[0];
  return { selected, matching, others, fallback: matching.length === 0, explicit: false };
}

export const AUDIENCE_LABEL: Record<Audience, string> = { own_org: "Only my organisation", external: "External customers" };
export const ACCESS_LABEL: Record<Access, string> = { read: "Read data", write: "Write or send", admin: "Admin / full access" };
