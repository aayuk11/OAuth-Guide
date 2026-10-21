# OAuth Readiness: build plan

Date: 2026-10-20. Source plan: `../Composio APM Take-home OAuth App Readiness — Understanding & Plan.md` (the "source plan").

This file records what was built, what changed from the source plan and why, and the spec the code follows. The use-case audit that tested this plan is in [AUDIT.md](AUDIT.md).

## 1. The product in one paragraph

A developer types an app name or URL and gets a shareable guide that answers four questions in order: do I need my own OAuth app (verdict), how hard and how long (difficulty level, hands-on effort, calendar wait, kept separate), what will block me (gates, prerequisites, blocker playbook), and what can an agent do versus what I must do (owner tag on every step). Every claim has an evidence label (Tested, Official, Reported, Unverified) and a date. Curated guides cover eight apps; every one of Composio's 221 OAuth2 toolkits, 99 DCR (MCP) toolkits and API-key toolkits gets an instant verdict card from Composio's own data; any other app is researched live by an agent that streams its work and ends in the same guide format.

## 2. What we keep from the source plan

- The thesis: registration takes under an hour almost everywhere; **gates** (review, verification, assessments, partner programmes, caps) set the timeline, and **scope choice** is the biggest lever.
- Verdict first, with four outcomes; effort and wait shown separately; a 1-to-4 level computed in code from gate types; badges for Cost, Identity, After launch, Customer admin.
- Owner tags (Done by agent, Agent can do, Agent drafts / you submit, You) and evidence labels on every claim.
- Blocker playbook (symptom, cause, fix now, fix properly, escalate with a drafted message).
- The Composio wiring section (redirect URI, auth config, `ac_` id, reconnect warning).
- Demo set: GitHub, Gmail, Slack, Shopify, LinkedIn, Salesforce.

## 3. What changes, and why

| # | Source plan | Change | Why |
|---|---|---|---|
| 1 | "One Claude call with web search and web fetch answers into the schema" | **Two calls**: a research call (web search + web fetch, streamed) then an extraction call with structured output and **no tools** | Web search citations are always on, and citations cannot be combined with structured output (API returns 400). Splitting also means fetched page text can never trigger a tool call: the call that writes the guide has no tools. |
| 2 | Upstash Redis required | **Storage adapter**: Upstash REST if configured, else local files (`.data/`), else memory | The app must run with zero accounts (`npm run dev`) and deploy with one env var. Upstash is only needed for durable share links on serverless. |
| 3 | Live generation needs a key; library implied | **Library, search, verdict cards, checks and Markdown export work with no API key.** Only live research needs an AI key, which a visitor can paste in the site (or the server can hold); without one, the research page shows the key form | A reviewer or teammate can open and use it without setup; failure is explicit, not a blank page. |
| 4 | Probes before research on a domain | **Probes twice**: early when the input is a URL, and after extraction on the portal, docs and authorization server the agent found | For a bare app name we do not know the domain until research finds it. Post-research probes turn the agent's claims into Tested facts (DCR, PKCE, CIMD, URLs reachable). |
| 5 | Critic: code check + optional AI critic | **Code critic only, stricter**: each excerpt must appear (normalised, fuzzy) in the text the agent actually fetched; failures become Unverified; **waits and costs backed only by Unverified evidence are removed**; community domains are forced to Reported; the model cannot emit "Tested" | Deterministic, explainable in one sentence, cheap, and it enforces "numbers only from sources". |
| 6 | Verdict decided by the guide | **Verdict computed in code** from Composio data + the three intake answers + DCR probe | Same inputs always give the same answer; the model never decides the headline. |
| 7 | Intake chips change the path | Intake answers are **in the URL** (`?audience=external&access=read&brand=yes`) | A shared link opens with the sender's context intact. |
| 8 | 6 curated guides | **8**: adds Microsoft Outlook (publisher verification + customer admin consent) and Xero (bring-your-own only, connection cap) | Covers every gate family and both "managed" and "bring-your-own only" toolkits. |
| 9 | Verdict cards for 221 OAuth2 toolkits | Plus **99 DCR toolkits** ("no app registration needed") and **API-key toolkits** ("no OAuth app needed") from search | The panel's "unfamiliar app" may be either; both get an instant, correct verdict. |
| 10 | Re-verification is a plan | **`npm run verify:sources`** re-fetches every curated excerpt and reports which still match | The freshness mechanism exists and was run; its output is the verification log. |
| 11 | Agent accuracy measured by running the agent cold | **`npm run eval:agent`** runs the live pipeline on curated apps and scores gate types and levels against the curated answer key | Needs an API key; the script and the scoring exist so the number can be produced in minutes. |
| 12 | Model: "a current Claude Sonnet" | **Any of Claude, Gemini or GPT** behind one interface (`src/lib/llm/`). Defaults: `claude-sonnet-5-5`, `gemini-3.8-flash`, `gpt-6.1-sol`. Chosen in the site (AI key) or by `LLM_PROVIDER` / `LLM_MODEL` | Teams use different vendors and keys; nobody should redeploy to try it. The pipeline, schema and critic are the same for every provider. |
| 13 | Web tools | Each provider's own search (Claude web search + fetch, Gemini Google Search + URL context, GPT web search), then **the server reads the cited pages itself** | Only Claude returns the page text it read; reading pages in code gives the critic the same evidence whichever model ran. |
| 14 | Keys in env vars only | **Bring your own key in the site**: tested with a read-only call, stored AES-256-GCM encrypted in an HttpOnly, SameSite=Strict cookie scoped to `/api`; never stored server-side or returned | Removes the need to deploy or hard-code a key; the key stays with the person paying for it. |

## 4. Architecture

```
Browser ── search (client index of Composio catalogue + curated)
   │
   ├─ /apps/[slug]        curated guide or catalogue verdict card (static)
   ├─ /apps/gen/[key]     generated guide (from storage)
   ├─ /generate?q=…       live run: POST /api/generate → NDJSON stream of events
   │                      reconnect: GET /api/runs/[id]  (run keeps going via after())
   ├─ /evidence           verification log, conflicts, agent eval
   └─ /method             levels, labels, owner tags, scoring rules

Server
   lib/catalog       Composio toolkits.json snapshot → compact catalogue, search, aliases
   lib/guide         schema (zod), scoring (level, effort, wait, confidence), verdict, markdown
   lib/llm           provider adapters (Anthropic, Google, OpenAI), prompts, key encryption
   lib/agent         resolve → probe → research (LLM + web search) → read sources → extract (JSON schema)
                     → late probes → critic + coverage → save
   lib/net           SSRF-safe fetch (https only, public IPs only, timeouts, size caps)
   lib/store         Upstash REST | file | memory; runs, guides, rate limits
```

### Live run stages and events

| Stage | What happens | Event shown |
|---|---|---|
| resolve | Normalise input; match catalogue; ambiguous → candidates; curated/cached → redirect | `candidates` or `step` |
| composio | Auth schemes, managed status, default scopes, extra fields | `step` with summary |
| probe (early) | If a domain is known: OAuth/OIDC discovery, MCP discovery | `step`, `finding` |
| research | LLM + the provider's web search (about 6 searches); time box 150 s; then the server reads up to 8 cited pages | `search`, `read`, `step` |
| extract | Structured-output call into the draft schema | `step` |
| probe (late) | Discovery on found auth server, reachability of portal/docs | `finding` |
| critic | Excerpt check; downgrade; strip unsupported numbers; coverage of the 11 questions | `step` with counts |
| save | Guide saved at `/apps/gen/<key>` | `guide`, `done` |

Failure at any stage after research produces a **partial guide** (confidence Low, banner, Retry). The run record stores events, timings, token usage and estimated cost.

## 5. Guide schema (summary)

Full definition: `src/lib/guide/schema.ts`. Key decisions:

- **Paths** carry `applies` filters (audience, access). The intake answers select matching paths; a path switcher shows the rest.
- **Gates** have a type (maps to a level), trigger, how to avoid, wait `{min, max, unit}` or null (no published timeline), `after` (sequential dependency), `recurring`, and evidence ids.
- **Badges** carry kind (cost, identity, after_launch, customer_admin) and evidence.
- **Steps** carry owner, step type (maps to minutes), paths, paste values, links, an optional runnable check, and evidence.
- **Checks** answer the 11 core gate questions (yes / no / unknown). Unknown on a level-deciding question shows "Level N+ (unconfirmed)".
- **Evidence** has label, URL, title, retrieved date, verbatim excerpt, note, conflicts, and a verification record.
- Level, effort, wait, confidence and verdict are **computed at render**, never stored from the model.

## 6. Scoring rules (code)

- Level = highest gate level on the selected path (no gates = 1). Gate levels: verification-type 2; review-type 3; security assessment or annual re-verification 4.
- Wait = critical path over gates (`after` chains add; independent gates run in parallel, take the max). Calendar days convert to business days (x 5/7), weeks to business days (x 5). A gate with no published wait makes the total "at least".
- Effort = sum of step minutes by step type for the path (our estimate, always labelled so).
- Confidence: High if every gate claim is Official or Tested and at least one is Tested; Medium if every gate claim has a source but some are Reported or sources conflict; Low if any level-deciding question is unknown or any gate claim is Unverified.

## 7. Scope cut (what we do not build)

- Acting with the developer's identity: creating provider accounts, accepting terms, submitting reviews. The guide says so on each step.
- Accounts, comments, teams. Sharing is a link plus Markdown.
- All 100 full guides. The system and 8 curated guides prove it; the catalogue lists the 99 bring-your-own-only toolkits as the rollout queue.

## 8. Build order (as executed)

1. Data: Composio snapshot → compact catalogue (`npm run data:sync`).
2. Schema, scoring, verdict, Markdown, with unit tests.
3. Curated guides researched from official sources (parallel research agents), validated by schema, excerpts re-verified by script.
4. UI: home/search, guide page, catalogue card, method, evidence.
5. Live agent: pipeline, stream, storage, rate limits, partial results, mock mode for tests.
6. Security: SSRF-safe fetch, input limits, headers, no secrets.
7. Tests: unit (vitest), route smoke tests, browser screenshots at desktop and phone widths.
8. Docs: README, AUDIT results, verification log.

## 9. What needs the user's accounts (cannot be done by the builder)

- An Anthropic API key to run live generation, `eval:agent` and `rehearse`.
- Free provider accounts for hands-on checks (Google Cloud, Slack, GitHub, Salesforce Developer Edition, Shopify Partner). Until done, those claims stay labelled Official, not Tested.
- A Vercel account (and optionally Upstash) to deploy.
