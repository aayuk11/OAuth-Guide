import { z } from "zod";

/**
 * The guide schema: the single contract between curated guides, the live agent and the UI.
 * Level, effort, wait, confidence and verdict are never stored here; they are computed
 * from these fields at render time (see scoring.ts and verdict.ts).
 */

export const SCHEMA_VERSION = 1;

export const EVIDENCE_LABELS = ["tested", "official", "reported", "unverified"] as const;
export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

export const OWNERS = ["agent_done", "agent_can_do", "agent_drafts", "you"] as const;
export type Owner = (typeof OWNERS)[number];

export const AUDIENCES = ["own_org", "external"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const ACCESS_LEVELS = ["read", "write", "admin"] as const;
export type Access = (typeof ACCESS_LEVELS)[number];

/** Gate types and the difficulty level each one implies. Level 1 means "no gate". */
export const GATE_LEVELS = {
  brand_verification: 2,
  publisher_verification: 2,
  domain_verification: 2,
  production_approval: 2,
  app_review: 3,
  sensitive_scope_review: 3,
  product_access: 3,
  marketplace_listing: 3,
  security_assessment: 4,
  annual_reverification: 4,
} as const;
export type GateType = keyof typeof GATE_LEVELS;
export const GATE_TYPES = Object.keys(GATE_LEVELS) as [GateType, ...GateType[]];

export const BADGE_KINDS = ["cost", "identity", "after_launch", "customer_admin"] as const;
export type BadgeKind = (typeof BADGE_KINDS)[number];

/** Badge sub-types, grouped by kind. Free text is allowed but these are preferred. */
export const BADGE_TYPES: Record<BadgeKind, string[]> = {
  cost: ["paid_tier", "listing_fee", "assessor_fee", "review_fee", "usage_pricing"],
  identity: ["legal_entity", "verified_domain", "company_page", "partner_program", "business_verification", "privacy_policy"],
  after_launch: ["rate_limit_penalty", "install_cap", "user_cap", "test_token_expiry", "production_window"],
  customer_admin: ["admin_consent", "org_owner_approval", "admin_install"],
};

/** Step types map to a fixed hands-on time estimate (minutes). Effort is our estimate, never a provider claim. */
export const STEP_MINUTES = {
  create_account: 15,
  create_app: 15,
  configure_app: 20,
  configure_consent: 20,
  add_scopes: 10,
  set_redirect: 5,
  verify_domain: 30,
  write_policy: 60,
  write_justification: 60,
  record_video: 90,
  prepare_test_account: 30,
  submit_review: 20,
  respond_reviewer: 60,
  security_assessment: 480,
  recruit_installs: 240,
  join_program: 30,
  pay: 10,
  test: 30,
  wire_composio: 15,
  other: 15,
} as const;
export type StepType = keyof typeof STEP_MINUTES;
export const STEP_TYPES = Object.keys(STEP_MINUTES) as [StepType, ...StepType[]];

export const SCOPE_TIERS = ["no_review", "sensitive", "restricted", "admin_consent", "product_access", "unknown"] as const;
export type ScopeTier = (typeof SCOPE_TIERS)[number];

/** The 11 core gate questions every guide answers. */
export const CORE_QUESTIONS = [
  { id: "self_serve_registration", text: "Can a developer register an OAuth app self-serve?", levelDeciding: false },
  { id: "external_without_review", text: "Can users outside your organisation authorize the app without any review?", levelDeciding: true },
  { id: "scope_tiers", text: "Are some scopes tiered (sensitive, restricted, admin-only) with extra review?", levelDeciding: true },
  { id: "app_review", text: "Is there an app, product-access or marketplace review before production use?", levelDeciding: true },
  { id: "security_assessment", text: "Is a security assessment or recurring re-verification required?", levelDeciding: true },
  { id: "user_caps", text: "Are there user, install or connection caps before approval?", levelDeciding: false },
  { id: "identity_requirements", text: "Are a legal entity, verified domain or public privacy policy required?", levelDeciding: false },
  { id: "partner_or_paid", text: "Is a partner programme, paid tier or fee required?", levelDeciding: false },
  { id: "test_mode_limits", text: "Are there test-mode limits (test users, token expiry, rate limits)?", levelDeciding: false },
  { id: "published_timelines", text: "Does the provider publish review timelines?", levelDeciding: false },
  { id: "escalation", text: "Is there a documented escalation or contact route?", levelDeciding: false },
] as const;
export type CoreQuestionId = (typeof CORE_QUESTIONS)[number]["id"];
export const CORE_QUESTION_IDS = CORE_QUESTIONS.map((q) => q.id) as [CoreQuestionId, ...CoreQuestionId[]];

const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "ids are lowercase letters, digits, _ or -");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "http(s) only");
const evidenceRefs = z.array(id);
/** Path ids a block applies to; "*" means every path. */
const pathRefs = z.array(z.string()).min(1);

export const ProbeSchema = z.object({
  kind: z.enum(["oauth_discovery", "oidc_discovery", "mcp_discovery", "url_live", "redirect_uri"]),
  target: z.string(),
  ok: z.boolean(),
  summary: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type Probe = z.infer<typeof ProbeSchema>;

export const EvidenceSchema = z.object({
  id,
  label: z.enum(EVIDENCE_LABELS),
  url: httpUrl.nullable(),
  title: z.string().min(1),
  publisher: z.string().optional(),
  retrieved: isoDate,
  /** Verbatim supporting text from the page. Stored for checking; shown on demand. */
  excerpt: z.string().optional(),
  note: z.string().optional(),
  conflicts_with: z.array(id).optional(),
  /** Set when an evidence label was changed by the critic or by re-verification. */
  corrected: z
    .object({ from: z.enum(EVIDENCE_LABELS), reason: z.string() })
    .optional(),
  verification: z
    .object({
      status: z.enum(["verified", "not_found", "unfetchable", "not_checked"]),
      checked: isoDate,
      method: z.string(),
    })
    .optional(),
  probe: ProbeSchema.optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const WaitSchema = z.object({
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
  unit: z.enum(["business_days", "days", "weeks"]),
  note: z.string().optional(),
});
export type Wait = z.infer<typeof WaitSchema>;

export const GateSchema = z.object({
  id,
  type: z.enum(GATE_TYPES),
  title: z.string().min(1),
  trigger: z.string().min(1),
  /** How to avoid the gate, or null when it cannot be avoided on this path. */
  avoid: z.string().nullable(),
  /** null = the provider publishes no timeline. */
  wait: WaitSchema.nullable(),
  /** Gate id that must finish before this one starts (sequential). */
  after: id.nullable().optional(),
  recurring: z.enum(["yearly"]).nullable().optional(),
  evidence: evidenceRefs.min(1),
});
export type Gate = z.infer<typeof GateSchema>;

export const BadgeSchema = z.object({
  kind: z.enum(BADGE_KINDS),
  type: z.string().min(1),
  text: z.string().min(1),
  evidence: evidenceRefs.min(1),
});
export type Badge = z.infer<typeof BadgeSchema>;

export const ScopeSchema = z.object({
  scope: z.string().min(1),
  tier: z.enum(SCOPE_TIERS),
  what: z.string(),
  evidence: evidenceRefs,
});
export type Scope = z.infer<typeof ScopeSchema>;

export const StartItemSchema = z.object({
  when: z.string().min(1),
  action: z.string().min(1),
  owner: z.enum(OWNERS),
});

export const PathSchema = z.object({
  id,
  label: z.string().min(1),
  summary: z.string().min(1),
  applies: z.object({
    audience: z.array(z.enum(AUDIENCES)).optional(),
    access: z.array(z.enum(ACCESS_LEVELS)).optional(),
  }),
  recommended: z.boolean().optional(),
  /** True if Composio's default scopes for this toolkit land the developer on this path. */
  composio_default: z.boolean().optional(),
  /** Scope strings; classification lives in guide.scopes. */
  scopes: z.array(z.string()),
  gates: z.array(GateSchema),
  badges: z.array(BadgeSchema),
  start_here: z.array(StartItemSchema).min(1).max(4),
});
export type GuidePath = z.infer<typeof PathSchema>;

export const PrereqSchema = z.object({
  id,
  item: z.string().min(1),
  why: z.string().min(1),
  owner: z.enum(OWNERS),
  paths: pathRefs,
  evidence: evidenceRefs,
});

export const StepSchema = z.object({
  id,
  title: z.string().min(1),
  detail: z.string().min(1),
  owner: z.enum(OWNERS),
  type: z.enum(STEP_TYPES),
  paths: pathRefs,
  /** Override the step-type minutes when there is a better estimate (still ours). */
  minutes: z.number().int().positive().optional(),
  paste: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  link: z.object({ label: z.string(), url: httpUrl }).optional(),
  /** A check the page can run for the developer ("Agent can do"). */
  check: z.enum(["url_live", "redirect_uri", "oauth_discovery"]).optional(),
  evidence: evidenceRefs,
});
export type Step = z.infer<typeof StepSchema>;

export const BlockerSchema = z.object({
  id,
  symptom: z.string().min(1),
  cause: z.string().min(1),
  fix_now: z.string().min(1),
  fix_properly: z.string().min(1),
  escalate: z.object({
    channel: z.enum(["form", "email", "forum", "support", "partner_manager", "other"]),
    url: httpUrl.nullable().optional(),
    how: z.string().min(1),
    draft: z.string().optional(),
  }),
  paths: pathRefs,
  evidence: evidenceRefs,
});
export type Blocker = z.infer<typeof BlockerSchema>;

export const UnknownSchema = z.object({
  question: z.string().min(1),
  why: z.string().min(1),
  how_to_find_out: z.string().min(1),
  level_deciding: z.boolean(),
  paths: pathRefs,
});
export type Unknown = z.infer<typeof UnknownSchema>;

export const CheckSchema = z.object({
  q: z.enum(CORE_QUESTION_IDS),
  answer: z.enum(["yes", "no", "partly", "unknown"]),
  detail: z.string(),
  evidence: evidenceRefs,
});
export type CoreCheck = z.infer<typeof CheckSchema>;

export const GuideSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/),
  kind: z.enum(["curated", "generated"]),
  /** Composio toolkit slug, or null when the app is not in Composio's catalogue. */
  composio_slug: z.string().nullable(),
  app: z.object({
    name: z.string().min(1),
    provider: z.string().min(1),
    website: httpUrl.nullable(),
    developer_portal: httpUrl.nullable(),
    docs_url: httpUrl.nullable(),
    logo: httpUrl.nullable().optional(),
  }),
  /** One sentence: the key insight for this app. */
  headline: z.string().min(1),
  oauth: z.object({
    supported: z.enum(["yes", "no", "unknown"]),
    registration: z.enum(["manual", "dcr", "cimd", "manual_or_dcr", "unknown"]),
    notes: z.array(z.string()),
    evidence: evidenceRefs,
  }),
  default_intake: z
    .object({
      audience: z.enum(AUDIENCES),
      access: z.enum(ACCESS_LEVELS),
      brand: z.boolean(),
    })
    .optional(),
  paths: z.array(PathSchema).min(1),
  scopes: z.array(ScopeSchema),
  prerequisites: z.array(PrereqSchema),
  steps: z.array(StepSchema).min(1),
  while_you_wait: z.array(z.object({ text: z.string().min(1), paths: pathRefs })),
  blockers: z.array(BlockerSchema),
  checks: z.array(CheckSchema),
  unknowns: z.array(UnknownSchema),
  composio_notes: z.array(z.object({ text: z.string().min(1), evidence: evidenceRefs })),
  evidence: z.array(EvidenceSchema).min(1),
  last_verified: isoDate,
  meta: z
    .object({
      generated_at: z.string().optional(),
      model: z.string().optional(),
      provider: z.string().optional(),
      run_id: z.string().optional(),
      query: z.string().optional(),
      partial: z.boolean().optional(),
      partial_reason: z.string().optional(),
      /** Raw research notes, kept on partial guides so nothing the agent found is lost. */
      research_notes: z.string().optional(),
      app_found: z.boolean().optional(),
      critic: z
        .object({
          checked: z.number(),
          downgraded: z.number(),
          numbers_removed: z.number(),
          notes: z.array(z.string()),
        })
        .optional(),
      /** Core questions answered at all, and answered with a source that is not "unverified". */
      coverage: z.object({ answered: z.number(), confirmed: z.number(), total: z.number() }).optional(),
      research: z
        .object({
          /** False when the key had no web search and pages were read by URL only. */
          web_search: z.boolean().optional(),
          /** Set when research ran on a different model from the one chosen (Gemini free-tier search fallback). */
          model: z.string().optional(),
          searches: z.array(z.string()),
          pages_read: z.number(),
          duration_ms: z.number(),
          input_tokens: z.number(),
          output_tokens: z.number(),
          /** Absent when the provider's prices are not known here. */
          cost_usd: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});
export type Guide = z.infer<typeof GuideSchema>;

/**
 * Cross-reference checks zod cannot express: every evidence id exists, every path id
 * referenced exists, gate `after` points at a gate on the same path, scopes are classified.
 * Returns human-readable problems; empty means valid.
 */
export function crossCheckGuide(g: Guide): string[] {
  const problems: string[] = [];
  const evIds = new Set(g.evidence.map((e) => e.id));
  const pathIds = new Set(g.paths.map((p) => p.id));
  const scopeIds = new Set(g.scopes.map((s) => s.scope));

  const dupe = (ids: string[], what: string) => {
    const seen = new Set<string>();
    for (const i of ids) {
      if (seen.has(i)) problems.push(`duplicate ${what} id "${i}"`);
      seen.add(i);
    }
  };
  dupe(g.evidence.map((e) => e.id), "evidence");
  dupe(g.paths.map((p) => p.id), "path");
  dupe(g.steps.map((s) => s.id), "step");

  const refEv = (refs: string[], where: string) => {
    for (const r of refs) if (!evIds.has(r)) problems.push(`${where} cites missing evidence "${r}"`);
  };
  const refPaths = (refs: string[], where: string) => {
    for (const r of refs) if (r !== "*" && !pathIds.has(r)) problems.push(`${where} names missing path "${r}"`);
  };

  refEv(g.oauth.evidence, "oauth");
  for (const p of g.paths) {
    const gateIds = new Set(p.gates.map((x) => x.id));
    for (const gate of p.gates) {
      refEv(gate.evidence, `gate ${p.id}/${gate.id}`);
      if (gate.after && !gateIds.has(gate.after)) problems.push(`gate ${p.id}/${gate.id} runs after missing gate "${gate.after}"`);
      if (gate.wait && gate.wait.min !== null && gate.wait.max !== null && gate.wait.min > gate.wait.max)
        problems.push(`gate ${p.id}/${gate.id} wait min > max`);
    }
    for (const b of p.badges) refEv(b.evidence, `badge ${p.id}/${b.type}`);
    for (const s of p.scopes) if (!scopeIds.has(s)) problems.push(`path ${p.id} uses unclassified scope "${s}"`);
  }
  for (const s of g.scopes) refEv(s.evidence, `scope ${s.scope}`);
  for (const x of g.prerequisites) {
    refEv(x.evidence, `prerequisite ${x.id}`);
    refPaths(x.paths, `prerequisite ${x.id}`);
  }
  for (const x of g.steps) {
    refEv(x.evidence, `step ${x.id}`);
    refPaths(x.paths, `step ${x.id}`);
  }
  for (const x of g.blockers) {
    refEv(x.evidence, `blocker ${x.id}`);
    refPaths(x.paths, `blocker ${x.id}`);
  }
  for (const x of g.while_you_wait) refPaths(x.paths, "while_you_wait item");
  for (const x of g.unknowns) refPaths(x.paths, `unknown "${x.question.slice(0, 30)}"`);
  for (const x of g.checks) refEv(x.evidence, `check ${x.q}`);
  for (const x of g.composio_notes) refEv(x.evidence, "composio note");
  for (const e of g.evidence) {
    for (const c of e.conflicts_with ?? []) if (!evIds.has(c)) problems.push(`evidence ${e.id} conflicts with missing "${c}"`);
    if (e.label !== "unverified" && e.label !== "tested" && !e.url) problems.push(`evidence ${e.id} is ${e.label} but has no URL`);
    if (e.label === "official" && !e.excerpt) problems.push(`evidence ${e.id} is official but has no excerpt`);
  }
  const asked = new Set(g.checks.map((c) => c.q));
  if (g.kind === "curated") {
    for (const q of CORE_QUESTION_IDS) if (!asked.has(q)) problems.push(`core question "${q}" not answered`);
  }
  return problems;
}
