import type { Draft } from "./draft-schema";
import type { ResearchResult } from "@/lib/llm/types";
import type { RunEventInput } from "./events";

/**
 * Test-only stand-ins for the two model calls (AGENT_MOCK=1). They exercise the whole pipeline
 * (streaming, probes, critic, storage, rendering) without an API key. Output is labelled MOCK.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockResearch(query: string, emit: (e: RunEventInput) => void): Promise<ResearchResult> {
  emit({ type: "search", query: `${query} OAuth app review requirements` });
  await sleep(400);
  emit({ type: "progress", stage: "research", detail: "5 results" });
  emit({ type: "progress", stage: "research", detail: "Opening https://example.com/docs/oauth" });
  await sleep(400);
  emit({ type: "read", url: "https://example.com/docs/oauth", title: "Example OAuth docs (mock)", ok: true });
  return {
    notes: `MOCK research notes for ${query}. "Apps must be reviewed before they can be installed by other organisations." (https://example.com/docs/oauth)`,
    sources: [
      {
        id: "S1",
        url: "https://example.com/docs/oauth",
        title: "Example OAuth docs (mock)",
        fetched: true,
        text: "Create an app in the developer console. Apps must be reviewed before they can be installed by other organisations. Review usually takes 5 to 10 business days.",
        cited: [],
        pageAge: null,
      },
      { id: "S2", url: "https://community.example.com/t/review-times", title: "Forum: review times (mock)", fetched: false, text: "", cited: ["My review took three weeks."], pageAge: null },
    ],
    searches: [`${query} OAuth app review requirements`],
    usage: { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, searches: 1, fetches: 1 },
    stopReason: "end_turn",
    timedOut: false,
    refused: false,
  };
}

export async function mockDraft(query: string): Promise<Draft> {
  await sleep(500);
  return {
    app_found: true,
    app: { name: `${query} (MOCK)`, provider: query, website: "https://example.com", developer_portal: "https://example.com/developers", docs_url: "https://example.com/docs/oauth" },
    headline: "MOCK DATA: generated without calling a model, to test the pipeline. Do not rely on it.",
    oauth: { supported: "yes", registration: "manual", notes: ["Mock note."], evidence: ["E1"] },
    paths: [
      {
        id: "own-org",
        label: "Your own organisation",
        summary: "Use the app inside your own account.",
        audience: ["own_org"],
        access: ["read", "write", "admin"],
        recommended: false,
        uses_composio_defaults: false,
        scopes: ["read"],
        gates: [],
        badges: [],
        start_here: [{ when: "Day 1", action: "Create the app", owner: "you" }],
      },
      {
        id: "public",
        label: "Other organisations",
        summary: "Install in customers' accounts after review.",
        audience: ["external"],
        access: ["read", "write", "admin"],
        recommended: true,
        uses_composio_defaults: true,
        scopes: ["read", "write"],
        gates: [
          { title: "App review", type: "app_review", trigger: "Installing outside your organisation", avoid: "", wait_min: 5, wait_max: 10, wait_unit: "business_days", wait_note: "", after_title: "", yearly: false, evidence: ["E1"] },
          { title: "Security questionnaire", type: "security_assessment", trigger: "Requested by reviewers", avoid: "", wait_min: 15, wait_max: 15, wait_unit: "business_days", wait_note: "", after_title: "App review", yearly: false, evidence: ["E3"] },
        ],
        badges: [{ kind: "after_launch", type: "install_cap", text: "Unreviewed apps are limited (mock).", evidence: ["E2"] }],
        start_here: [{ when: "Day 1", action: "Submit the app for review", owner: "you" }],
      },
    ],
    scopes: [
      { scope: "read", tier: "no_review", what: "Read data", evidence: ["E1"] },
      { scope: "write", tier: "sensitive", what: "Write data", evidence: [] },
    ],
    prerequisites: [{ item: "Privacy policy URL", why: "Required for review", owner: "you", path_ids: ["public"], evidence: ["E1"] }],
    steps: [
      { title: "Create a developer account", detail: "Sign up.", owner: "you", type: "create_account", path_ids: ["*"], paste_label: "", paste_value: "", evidence: [] },
      { title: "Create the app", detail: "In the console.", owner: "you", type: "create_app", path_ids: ["*"], paste_label: "", paste_value: "", evidence: ["E1"] },
      { title: "Add the redirect URI", detail: "Paste it exactly.", owner: "you", type: "set_redirect", path_ids: ["*"], paste_label: "Redirect URI", paste_value: "https://backend.composio.dev/api/v3/toolkits/auth/callback", evidence: [] },
      { title: "Submit for review", detail: "Fill the form.", owner: "you", type: "submit_review", path_ids: ["public"], paste_label: "", paste_value: "", evidence: ["E1"] },
    ],
    while_you_wait: ["Build against your own organisation."],
    blockers: [
      { symptom: "Install blocked", cause: "App not reviewed", fix_now: "Use your own org", fix_properly: "Pass review", escalate_channel: "support", escalate_url: "https://example.com/support", escalate_how: "Open a ticket", draft_message: "Hello, our review is pending.", evidence: ["E1"] },
    ],
    checks: [
      { q: "self_serve_registration", answer: "yes", detail: "Mock", evidence: ["E1"] },
      { q: "external_without_review", answer: "no", detail: "Mock", evidence: ["E1"] },
      { q: "app_review", answer: "yes", detail: "Mock", evidence: ["E1"] },
      { q: "security_assessment", answer: "unknown", detail: "Mock", evidence: [] },
    ],
    unknowns: [{ question: "Is a security questionnaire always required?", why: "Changes the level", how_to_find_out: "Ask support", level_deciding: true }],
    composio_notes: [],
    evidence: [
      { ref: "E1", source: "S1", label: "official", excerpt: "Apps must be reviewed before they can be installed by other organisations.", note: "" },
      { ref: "E2", source: "S2", label: "official", excerpt: "My review took three weeks.", note: "" },
      { ref: "E3", source: "S1", label: "official", excerpt: "A security questionnaire is mandatory for all apps.", note: "" },
    ],
  };
}
