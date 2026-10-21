# Research brief for curated guides (shared by all research agents)

You are writing ONE curated "OAuth readiness guide" as JSON for the app named in your task.
All paths below are relative to the repository root.

## What the product is
A developer building an AI agent on Composio wants their users to connect an app via OAuth. Before launch they may need
their own OAuth app with the provider, and approval. The guide tells them: do they need their own app, how hard and how
long (difficulty level from gates; hands-on effort vs calendar wait, separately), what will block them, and which steps an
agent can do vs. what they must do. Every claim carries an evidence label and date. Readers are developers, PMs and
founders; they will follow and share the guide without anyone explaining it.

## The schema (the contract) — READ IT FIRST
`src/lib/guide/schema.ts` defines GuideSchema (zod) and crossCheckGuide(). Your JSON must pass both.
Key rules from it:
- Gate types and the level they imply: brand_verification / publisher_verification / domain_verification / production_approval = 2;
  app_review / sensitive_scope_review / product_access / marketplace_listing = 3; security_assessment / annual_reverification = 4.
  A path with no gates is Level 1 (self-serve). Only add a gate if a source shows the provider actually imposes it on that path.
- Badges (shown separately from level): cost (paid_tier, listing_fee, assessor_fee, review_fee, usage_pricing),
  identity (legal_entity, verified_domain, company_page, partner_program, business_verification, privacy_policy),
  after_launch (rate_limit_penalty, install_cap, user_cap, test_token_expiry, production_window),
  customer_admin (admin_consent, org_owner_approval, admin_install).
- Step types map to a fixed minutes table (our estimate). Use the closest type; `minutes` override only with good reason.
- Owners: agent_done (we already checked it; cite a tested evidence item), agent_can_do (a check the page can run: url_live,
  redirect_uri, oauth_discovery — set `check`), agent_drafts (copy-ready text/values the developer submits), you (needs the
  developer's login, money, legal identity, a video, or the final Submit).
- Waits: `{min, max, unit}` ONLY from a source that states it. If no source states a timeline, `wait: null`.
  Community-reported timelines are allowed only with a `reported` evidence item and a `note` saying so.
  If two official sources disagree, use the range covering both, cite both, and set `conflicts_with` on the evidence items.
- `after`: set when a gate cannot start until another finishes (sequential). Parallel gates leave it null.
- Paths: one per real route to production (e.g. "own org only", "public unlisted", "marketplace listing";
  for Google: by scope tier). `applies.audience` / `applies.access` decide which paths match the reader's answers to:
  who connects (own_org | external), what access (read | write | admin). Mark exactly one `recommended` path where sensible,
  and set `composio_default: true` on the path that Composio's DEFAULT scopes (given below) put the developer on.
- `scopes`: classify every scope used by any path AND every Composio default scope listed below (tier: no_review, sensitive,
  restricted, admin_consent, product_access, unknown). Use `unknown` rather than guessing; cite evidence where possible.
- `checks`: answer ALL 11 core questions (ids in CORE_QUESTIONS) with yes/no/partly/unknown + one-line detail + evidence.
- `unknowns`: what you could not establish, why it matters, how to find out; `level_deciding: true` if it could change the level.
- `steps`: 6–14 ordered steps from zero to "client ID and secret in hand + ready for production", including review submission
  where a path needs it. Use exact console names/menus where sources give them. Put copy-ready values in `paste`
  (e.g. redirect URI `https://backend.composio.dev/api/v1/auth-apps/add`, scope strings, justification text).
  Do NOT write Composio wiring steps (create auth config, paste client id, use ac_ id): the app appends those automatically.
  Composio-specific facts (extra fields, quirks) go in `composio_notes` with evidence.
- `blockers`: 3–5 real failure modes (symptom the developer sees, cause, fix now, fix properly, escalate with channel, url,
  how, and a short `draft` message they can paste). Prefer blockers documented by the provider or seen repeatedly in forums.
- `start_here` per path: the first 1–3 actions in critical-path order ("Day 1: submit X; meanwhile build in test mode").
- `headline`: one sentence, the key insight for this app.
- `while_you_wait`: how to keep building during review (test mode limits, test users).
- Plain English. Short sentences. No marketing. No unexplained jargon. British or American spelling is fine; be consistent.

## Evidence rules (this is graded hardest)
- Every evidence item: id (e.g. "e-google-faq"), label, url, title, publisher, retrieved "2026-10-20", excerpt, optional note.
- `official` = the provider's own docs/help/changelog/policy pages. `reported` = forums, community, third-party blogs,
  competitor docs. `unverified` = your inference with no source (keep these rare and say so in `note`).
- `tested` = ONLY things you actually executed and observed today, e.g. you fetched the provider's
  `/.well-known/openid-configuration` or `/.well-known/oauth-authorization-server` with curl and recorded whether
  `registration_endpoint` exists, PKCE methods, grant types. For tested items set `url` to the URL you fetched, put a short
  observed fact in `excerpt` (e.g. "no registration_endpoint; code_challenge_methods_supported: S256"), and add
  `probe: {kind: "oidc_discovery"|"oauth_discovery", target: <url>, ok: true|false, summary: <one line>, data: {...}}`.
  Never label anything tested that you did not run.
- Excerpts must be VERBATIM text from the page (≤ 300 chars), copied from what our verifier sees. Get page text with:
    npx tsx scripts/fetch-text.ts <url> [term ...]
  (prints the page as plain text; with terms, only matching lines). Copy a sentence or clause exactly from that output.
  You may also use WebSearch to find pages and WebFetch to read them, but copy excerpts from fetch-text output, because
  WebFetch paraphrases. If a page is JS-rendered (fetch-text shows almost no text), you may still cite it as official with
  an excerpt taken from WebFetch, but say "page renders client-side; excerpt from rendered page" in `note`.
- Prefer the most specific, current official page. Check dates/changelogs: rules changed in 2025–2026 for several providers.
- The "hypotheses" in your task come from an earlier research pass. Treat each as UNVERIFIED. Confirm, correct, or drop it.
  Report every correction.

## Validation loop (must pass before you finish)
1. Write `src/data/guides/<slug>.json` (only this file; do not edit any other file in the repo).
2. `npm run validate -- <slug>`  → must print ✓.
3. `npm run verify:sources -- <slug>` → every official/reported excerpt should be "verified". For "not_found", fix the
   excerpt to match the page text exactly; for "unfetchable", keep it only if you confirmed the text another way, and say so in `note`.
4. Repeat until clean.

## Final message (your report back, ≤ 350 words)
- Headline insight; level range across paths; recommended path.
- Corrections to the hypotheses (what was wrong or outdated, with the source).
- Conflicts between sources.
- What you could not verify.
- Tested probes you ran.
- Final validate result and verify:sources counts (verified / not_found / unfetchable).
