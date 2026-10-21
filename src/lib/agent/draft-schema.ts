import { z } from "zod";
import { ACCESS_LEVELS, AUDIENCES, BADGE_KINDS, CORE_QUESTION_IDS, GATE_TYPES, OWNERS, SCOPE_TIERS, STEP_TYPES } from "@/lib/guide/schema";

/**
 * The schema the extraction call fills via structured output.
 * Structured output allows at most 24 optional properties and 16 union-typed ones, so every
 * field here is required, there are no nullable types, and "unknown" uses sentinels:
 * -1 for numbers, "" for text, "none" for a source. Code converts this to the Guide schema.
 */

const refs = z.array(z.string()).describe('Evidence refs like "E1", "E2"');

export const DraftEvidenceSchema = z.object({
  ref: z.string().describe('Unique ref, "E1", "E2", ...'),
  source: z.string().describe('Source id from the SOURCES list, e.g. "S3", or "none" if no source supports it'),
  label: z.enum(["official", "reported", "unverified"]),
  excerpt: z.string().describe("Verbatim sentence or clause copied from that source's text, max 300 characters. Empty only if source is none."),
  note: z.string().describe("Optional short note, e.g. that two sources disagree. Empty if none."),
});

export const DraftGateSchema = z.object({
  title: z.string(),
  type: z.enum(GATE_TYPES),
  trigger: z.string().describe("What triggers this gate"),
  avoid: z.string().describe("How to avoid it on this path, or empty if unavoidable"),
  wait_min: z.number().describe("Minimum stated wait, or -1 if no source states one"),
  wait_max: z.number().describe("Maximum stated wait, or -1 if no source states one"),
  wait_unit: z.enum(["business_days", "days", "weeks"]),
  wait_note: z.string().describe('E.g. "community-reported" or "two official pages disagree"; empty if none'),
  after_title: z.string().describe("Title of a gate on the same path that must finish first, or empty"),
  yearly: z.boolean().describe("True if the gate repeats every year"),
  evidence: refs,
});

export const DraftPathSchema = z.object({
  id: z.string().describe('Short kebab-case id, e.g. "own-org", "public", "marketplace"'),
  label: z.string(),
  summary: z.string(),
  audience: z.array(z.enum(AUDIENCES)).describe("Which readers this path is for; both if either"),
  access: z.array(z.enum(ACCESS_LEVELS)).describe("Which access levels this path covers"),
  recommended: z.boolean(),
  uses_composio_defaults: z.boolean().describe("True if Composio's default scopes land the developer on this path"),
  scopes: z.array(z.string()),
  gates: z.array(DraftGateSchema),
  badges: z.array(
    z.object({
      kind: z.enum(BADGE_KINDS),
      type: z.string().describe("e.g. paid_tier, listing_fee, legal_entity, verified_domain, install_cap, rate_limit_penalty, admin_consent"),
      text: z.string(),
      evidence: refs,
    }),
  ),
  start_here: z.array(z.object({ when: z.string(), action: z.string(), owner: z.enum(OWNERS) })),
});

export const DraftSchema = z.object({
  app_found: z.boolean().describe("False if you could not identify a real app/provider matching the request"),
  app: z.object({
    name: z.string(),
    provider: z.string(),
    website: z.string().describe("https URL or empty"),
    developer_portal: z.string().describe("https URL or empty"),
    docs_url: z.string().describe("https URL of OAuth/auth docs, or empty"),
  }),
  headline: z.string().describe("One sentence: the key insight for this app"),
  oauth: z.object({
    supported: z.enum(["yes", "no", "unknown"]),
    registration: z.enum(["manual", "dcr", "cimd", "manual_or_dcr", "unknown"]),
    notes: z.array(z.string()),
    evidence: refs,
  }),
  paths: z.array(DraftPathSchema),
  scopes: z.array(z.object({ scope: z.string(), tier: z.enum(SCOPE_TIERS), what: z.string(), evidence: refs })),
  prerequisites: z.array(z.object({ item: z.string(), why: z.string(), owner: z.enum(OWNERS), path_ids: z.array(z.string()), evidence: refs })),
  steps: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      owner: z.enum(OWNERS),
      type: z.enum(STEP_TYPES),
      path_ids: z.array(z.string()).describe('Path ids this step applies to, or ["*"] for all'),
      paste_label: z.string().describe("Label for a copy-ready value, or empty"),
      paste_value: z.string().describe("Copy-ready value (URL, scope list, text), or empty"),
      evidence: refs,
    }),
  ),
  while_you_wait: z.array(z.string()),
  blockers: z.array(
    z.object({
      symptom: z.string(),
      cause: z.string(),
      fix_now: z.string(),
      fix_properly: z.string(),
      escalate_channel: z.enum(["form", "email", "forum", "support", "partner_manager", "other"]),
      escalate_url: z.string().describe("https URL or empty"),
      escalate_how: z.string(),
      draft_message: z.string(),
      evidence: refs,
    }),
  ),
  checks: z.array(z.object({ q: z.enum(CORE_QUESTION_IDS), answer: z.enum(["yes", "no", "partly", "unknown"]), detail: z.string(), evidence: refs })),
  unknowns: z.array(z.object({ question: z.string(), why: z.string(), how_to_find_out: z.string(), level_deciding: z.boolean() })),
  composio_notes: z.array(z.string()),
  evidence: z.array(DraftEvidenceSchema),
});
export type Draft = z.infer<typeof DraftSchema>;
