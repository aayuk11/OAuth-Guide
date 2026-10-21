# Use-case audit

The plan in [PLAN.md](PLAN.md) was checked against the situations below before building, then each was tested on the production build (`next build && next start`) on 2026-10-20. Live research ran in mock mode, with a fake provider, and through simulated APIs for Claude, Gemini and GPT that replay documented response shapes. Key checks ran against the real Anthropic, Google and OpenAI APIs with invalid keys; no valid key was used.

Legend: ✅ passed in test · ⚠️ works, with the stated limit · ⏳ needs an API key or provider accounts to test.

## 1. Interview panel

| ID | Situation | Must happen | Design response | Result |
|---|---|---|---|---|
| I1 | Panel opens the link cold, on a laptop or phone | Loads fast, no login, explains itself in one screen | Value statement and level legend above the fold; responsive layout | ✅ Home 42 ms server time (prod). No horizontal scroll at 390 px on 18 pages (`qa:overflow`). No console errors. |
| I2 | Searches a curated app (Gmail) | Guide in under 1 s; verdict, level, effort, wait, confidence above the fold | Client-side suggestions; `/go` resolves and redirects | ✅ `/go?q=Gmail` → `/apps/gmail` (307); page 89 ms server time, 94 KB gzipped |
| I3 | Changes "who connects / what access / your brand" | Verdict, path, level and wait change; the URL keeps the answers | Intake in the query string; scoring in code | ✅ Own org + no brand → "managed app works"; external + brand → "managed now, own app before launch"; unit tests for path choice |
| I4 | Switches Gmail between send, read and full-mailbox | Level 3 → 4, wait and badges change; Composio default flagged | Paths with scope tiers; `composio_default` marker | ✅ internal L1 · send-only L3 (3–13 business days) · read L4 (6–7 weeks+, then yearly) · full-mailbox L4 (Composio defaults) |
| I5 | Types an app in Composio but not curated (Pipedrive) | Instant verdict from Composio data, default scopes, research button | Catalogue page for every toolkit | ✅ "Bring your own OAuth app now", scopes, per-user fields, wiring steps |
| I6 | Types an unfamiliar app (Jobber, Clio) | Progress within 3 s, visible searches and reads, guide in minutes, partial on failure | NDJSON stream, time boxes, partial save | ✅ in mock mode: first event at 1 ms, redirect to the guide on completion. ⏳ real model timing: run `npm run rehearse` |
| I7 | Ambiguous name ("Meta", "Google", "Microsoft") | Pick from candidates; can still research as typed | Alias map + catalogue match | ✅ "Meta" → Facebook, Instagram, WhatsApp, Meta Ads; "Teams" → Microsoft Teams; "X" → Twitter |
| I8 | API-key-only app (OpenAI) | "No OAuth app needed" instantly | Verdict from Composio auth schemes | ✅ |
| I9 | MCP server (Notion MCP) | "No app registration needed" with a Tested probe | DCR toolkits + live discovery check | ✅ Verdict from data; live probe of `mcp.notion.com` found `registration_endpoint` and Client ID Metadata Documents |
| I10 | Pastes a URL (`https://www.getjobber.com`) | Domain recognised and probed | URL parsing; domain-to-toolkit matching | ✅ Matched Composio's Jobber toolkit; real probe found Jobber's discovery document at `api.getjobber.com` (manual registration, PKCE S256) |
| I11 | Types nonsense ("asdfqwer") | Honest result, no invented guide | `app_found=false` path; not-found banner | ✅ routed to research (or closest matches without a key). ⏳ the model's "not found" answer needs a key |
| I12 | Types HTML or an injection attempt | Rendered as text; nothing executes | Markup stripped; React escaping; extraction call has no tools | ✅ `<img onerror>` and `<script>` render as inert text. ⏳ prompt-injection behaviour of the model needs a key |
| I13 | Same app twice, or two people at once | Reuse the running or saved result | In-flight dedupe; 7-day cache; Re-check forces fresh | ✅ Second concurrent request attached to the same run; repeat returned the saved guide |
| I14 | Closes the tab mid-run | Guide still saved; run reopenable | `after()`; events persisted | ✅ Client disconnected at 0.4 s; run finished and the guide page returned 200 |
| I15 | Shares a link in Slack | Preview shows app, verdict, level, date | `generateMetadata` | ✅ og:title "Gmail: OAuth app readiness"; description includes verdict, level range and last-verified date |
| I16 | Asks "how do you know?" | Evidence on every claim; verification log | Evidence chips with source tooltips; `/evidence` | ✅ 625 sources, 572/607 excerpts re-found on their pages, 17 tested probes, corrections and conflicts listed |
| I17 | No key, bad key, out of credit, or rate-limited | Clear message; library keeps working | Key form in place of the run; provider errors mapped to messages | ✅ No key: 401 `no_key` and `/generate` shows the key form; library 200. Bad key: real Anthropic, Google and OpenAI calls each give "The … API key was rejected." and no cookie is set. ⏳ real 429 / out of credit |
| I18 | Panel shares one network | Several runs allowed | 20 per IP per hour, daily cap | ✅ With the limit set to 2, the third run returned 429 with a clear message |
| I19 | Exports Markdown for a ticket | Verdict, numbers, steps, sources and legend | Copy and download buttons | ✅ Standalone Markdown with the legend; download sets a filename |
| I20 | Partner-gated or enterprise app (Salesforce, SAP) | Partner requirement surfaced; honest confidence | Identity badges; unknowns raise "N+ (unconfirmed)" | ✅ Salesforce customer-orgs path shows "L3+ (unconfirmed)", confidence Low, ISV Partner Program requirement cited |
| I21 | Panel member wants to try research with their own key | Paste a key in the site, no redeploy; key stays private | AI key dialog; encrypted HttpOnly cookie scoped to `/api` | ✅ Dialog and inline form checked in light, dark and phone (`qa:keys`); cookie is AES-256-GCM, tamper-proof and never returned (unit tests); cross-site POSTs get 403 |
| I22 | Generated guide is thin or wrong | The reader can tell before relying on it | Coverage count, "Needs review" flag, critic counts, run log link | ✅ Mock run: "3 of 11 core questions … confirmed", amber Needs review, Run log opens the full event list |

## 2. Company use (Composio team)

| ID | Situation | Must happen | Design response | Result |
|---|---|---|---|---|
| C1 | Run locally with no keys | `npm install && npm run dev` works | No required env vars | ✅ |
| C2 | Deploy from GitHub to Vercel | `APP_SECRET` for in-site keys; optional server key and Upstash | Storage adapter; `.env.example`; CI workflow | ⚠️ Production build passes; CI workflow added; not deployed from here (needs your GitHub and Vercel accounts) |
| C3 | Add a curated guide | Drop JSON, validate, it appears | Generated index of valid guides | ✅ `validate` and the index run before `dev` and `build`; invalid guides are skipped with a warning |
| C4 | Refresh Composio data | One command | `data:sync` | ✅ 1,608 toolkits; counts match the data (221 / 122 / 99 / 99) |
| C5 | Keep guides fresh | Drift report per excerpt | `verify:sources` | ✅ Ran on all 8 guides: 572 verified, 1 not found, 34 unfetchable (explained) |
| C6 | Reuse guide data elsewhere | Stable JSON and Markdown endpoints | `/api/guides/[key]` with computed fields | ✅ |
| C7 | Change provider, model or limits | No code changes | In the site (AI key) or env: `LLM_PROVIDER`, `LLM_MODEL`, efforts, limits | ✅ Provider choice by `LLM_PROVIDER`, else the first key set; browser key wins over server key (unit tests) |
| C8 | Security review | No secrets; no SSRF; no HTML injection | SSRF guard; escaping; headers | ✅ localhost, metadata IP, private ranges, file:// and internal hostnames all blocked; nosniff, frame, referrer and permissions headers set; no X-Powered-By |
| C9 | Accessibility | Keyboard reachable, labelled controls, readable at 375 px | Semantic HTML, focus styles, skip link | ✅ Phone layouts checked; evidence tooltips work on keyboard focus and become a bottom sheet on phones |
| C10 | Cost visibility | Tokens and estimated cost per run | Stored on the run and shown on the guide | ✅ in mock and simulated runs; cost shown only where prices are listed, otherwise omitted rather than guessed. ⏳ real cost: `npm run rehearse` |
| C11 | Support sends a link | Stable permalinks with context | Slugs + query-string intake | ✅ |
| C12 | Measure agent quality | Accuracy against the curated guides | `eval:agent` | ✅ script and scoring tested in mock mode. ⏳ real score needs a key, per provider |
| C13 | Keep a visitor's key off the company's bill and limits | Runs on a visitor key do not use the site's daily budget | Daily cap applies only to the server key; per-network limit applies to all | ✅ |
| C14 | Every change is checked before it ships | CI on push and pull request | `.github/workflows/ci.yml`: validate, lint, typecheck, test, build | ⚠️ Runs once the repository is on GitHub |

## 3. Risks found by the audit, and fixes applied

| Found | Fix |
|---|---|
| Structured output cannot be combined with web-search citations | Two-call agent (PLAN §3 row 1) |
| A bare app name gives no domain to probe | Probes run again on what research finds |
| "Check my URL" buttons could reach internal networks | SSRF-safe fetch, checked at connect time |
| The SDK's zod helper drops `enum` from the structured-output schema (moves it into the description) | Own schema conversion keeps all 16 enums; zod validates the reply; unit test guards it |
| `192.0.0.0/16` was wrongly treated as private, blocking github.blog | Only the reserved /24 ranges are blocked; test added |
| Hidden tooltips and unbreakable strings widened phone layouts | Tooltips render only on hover or focus (bottom sheet on phones); long text wraps |
| Composio's toolkit data still lists the legacy `v1` redirect URI | Guides and wiring steps show the current `v3` callback first, with the legacy value labelled |
| Shared links lost the reader's context | Intake answers in the URL |
| Gemini and GPT do not return the text of pages they read, so quotes could not be checked | The server reads cited pages itself (SSRF-guarded) before writing and checking the guide |
| Google reports a bad key as HTTP 400 with raw JSON | Mapped to "The Gemini API key was rejected."; test uses the real response text |
| A daily cap shared by everyone would block visitors bringing their own key | Daily cap counts only runs on the site's key |

## 4. Not tested here, and how to test

1. With a key (in the site under AI key, or `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in `.env.local`): `npm run generate -- "Jobber"`, then `npm run rehearse` (10 unfamiliar apps; writes `docs/REHEARSAL.md` with time, cost and outcome) and `npm run eval:agent` (accuracy against the curated guides; shows on `/evidence`).
2. Hands-on provider checks listed on `/evidence` (Google Cloud, Slack, GitHub, Salesforce, Shopify, LinkedIn accounts).
3. Push to GitHub, import into Vercel with `APP_SECRET` and Upstash, add a key in the site, and open a generated guide's link from a second browser.
