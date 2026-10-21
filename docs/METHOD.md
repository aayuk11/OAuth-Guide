# How OAuth Readiness works

For engineers who will run, extend or audit the system. It covers:

- the guide format
- how every number is computed
- how researched guides are verified
- how live research works and is kept accurate
- how to extend the system

To use a guide to ship an integration, read [GUIDE.md](GUIDE.md) instead.

**The rule behind everything:** models gather and draft; code decides. The verdict, level, wait, effort and confidence are computed from a guide's structured fields, so the same inputs always give the same answer.

## Contents

1. [The guide format](#1-the-guide-format)
2. [The numbers, computed in code](#2-the-numbers-computed-in-code)
3. [Researched guides (the library)](#3-researched-guides-the-library)
4. [Live research](#4-live-research)
5. [Keeping the agent accurate](#5-keeping-the-agent-accurate)
6. [Safety and keys](#6-safety-and-keys)
7. [Extending it](#7-extending-it)
8. [File map](#8-file-map)

## 1. The guide format

One schema, [`src/lib/guide/schema.ts`](../src/lib/guide/schema.ts) (zod), is the contract between the researched guides, the live agent, the UI, the API and the Markdown export. `crossCheckGuide()` adds the checks zod cannot express: every evidence id exists, gate `after` links point to a gate on the same path, and (for researched guides) every core question is answered.

| Field | What it holds |
|---|---|
| `app`, `oauth` | Name, website, developer portal, docs; whether OAuth is supported and how clients register (manual, dynamic registration, metadata documents) |
| `paths` | Routes to production (e.g. own organisation only, public, marketplace), each with the audiences and access levels it serves |
| `paths[].gates` | Approval gates on that path: type, what it needs, stated wait (`min`/`max`/`unit`), `after` (depends on another gate), `recurring`, evidence |
| `paths[].badges` | Cost, identity, after-launch and customer-admin requirements |
| `steps` | Ordered setup steps: type, owner, paths they apply to, copy-ready values, evidence |
| `scopes` | Scopes with their review tier (no review, sensitive, restricted, admin consent, product access) |
| `checks` | Answers to the 11 core questions (yes / no / partly / unknown), each with evidence |
| `blockers` | Troubleshooting: symptom, cause, fix now, fix properly, escalation, drafted message |
| `unknowns` | Open questions, flagged when they could change the level |
| `evidence` | Every source: URL, verbatim excerpt, label, date read, conflicts |

**The 11 core questions** make guides comparable across apps. The four marked "level-deciding" can change the difficulty level.

1. Self-serve registration?
2. External users without review? (level-deciding)
3. Tiered scopes? (level-deciding)
4. App review? (level-deciding)
5. Security assessment? (level-deciding)
6. User caps?
7. Identity requirements?
8. Partner or paid tier?
9. Test-mode limits?
10. Published timelines?
11. Escalation route?

**Evidence labels:**

| Label | How it is set |
|---|---|
| Tested | Our own probe: OAuth/OpenID/MCP discovery documents, URL checks, redirect URI checks. The model can never set it. |
| Official | The provider's own docs, with a verbatim excerpt found on the page |
| Reported | Forums, blogs and third parties (forced by domain) |
| Unverified | No excerpt could be confirmed |

## 2. The numbers, computed in code

All in [`src/lib/guide/scoring.ts`](../src/lib/guide/scoring.ts) and [`verdict.ts`](../src/lib/guide/verdict.ts).

**Level** is the highest level among the gates on the selected path; no gates means Level 1.

| Gate type | Level |
|---|---|
| brand, publisher or domain verification; production approval | 2 Light check |
| app review, sensitive-scope review, product access, marketplace listing | 3 Reviewed |
| security assessment, annual re-verification | 4 Heavy |

If a level-deciding question is unknown, or an open question is flagged level-deciding, the level shows as unconfirmed ("L3+").

**Calendar wait** is the critical path over the path's gates:

- A gate with `after` starts when that gate finishes; others run in parallel. Waits are converted to business days.
- A gate with no published timeline makes the total open-ended (`+`). A yearly gate adds "then yearly".
- Waits come only from sources. The critic removes a wait whose only support is Unverified.

**Hands-on effort** is our estimate, never a provider claim. Each step type has a set time (`STEP_MINUTES` in the schema) unless the guide gives that step its own `minutes`; the path's steps are summed, plus 15 minutes of Composio wiring. Examples: create an app 15 min, write a justification 60 min, record a demo video 90 min, prepare for a security assessment 8 h.

**Confidence** starts high and drops:

- **Low** if any of these hold:
  - the guide is partial
  - the app could not be identified
  - a level-deciding question is open
  - a gate or level-deciding claim is Unverified
- **Medium** if any of these hold:
  - a gate or level-deciding claim rests only on Reported sources
  - two sources on the path disagree

**Verdict:** the first rule that matches wins.

| # | Rule | Verdict |
|---|---|---|
| 1 | The Composio toolkit uses an API key or other non-OAuth auth; or, for an app outside the catalogue, research found no OAuth | No OAuth app needed |
| 2 | Composio's toolkit uses dynamic client registration; or, for an app outside the catalogue, a registration endpoint was found | No app registration needed |
| 3 | Not in Composio's catalogue | Bring your own (if OAuth is confirmed), else Not yet known |
| 4 | Composio has no managed app for the toolkit | Bring your own OAuth app |
| 5 | Managed app exists and the reader wants their own brand | Managed now, your own app before launch |
| 6 | Managed app exists | Composio's managed app works, with its limits listed |

**Path choice:** the reader's answers (who connects, access) pick the matching paths, then the recommended one among them. An explicit `?path=` wins.

## 3. Researched guides (the library)

Eight apps were researched by hand-guided research agents against a shared brief ([`research/BRIEF.md`](research/BRIEF.md)), then:

1. **Validated:** `npm run validate` checks the schema and cross-references. Only valid guides are indexed.
2. **Re-verified:** `npm run verify:sources` re-fetches every Official and Reported source and checks each excerpt is still on the page (`-- --write` records the results in the guides).
   - On 2026-10-20: 572 of 607 excerpts were found verbatim, 1 was not found (explained on the source), and 34 pages could not be fetched by script.
   - The unfetchable ones are Salesforce returning 403 to scripts, Xero's browser-only docs, and Composio's dataset exceeding the size cap. They were confirmed another way.
3. **Reviewed:** corrections, conflicts and open questions are logged on the site's Evidence page.

Composio's toolkit data ([`src/data/composio/catalog.json`](../src/data/composio/catalog.json), refreshed with `npm run data:sync`) gives every one of the 1,608 toolkits a verdict, default scopes and wiring, even without a guide.

## 4. Live research

For apps without a researched guide. The pipeline is [`src/lib/agent/pipeline.ts`](../src/lib/agent/pipeline.ts); code calls each stage in a fixed order.

| # | Stage | Runs as | What happens |
|---|---|---|---|
| 1 | Identify | Code | Match the name or website to Composio's catalogue; ask when ambiguous; reuse a saved guide unless a fresh one is asked for |
| 2 | Composio | Code | Auth schemes, managed status, default scopes, per-user fields |
| 3 | Probe | Code | If the domain is known: OAuth, OpenID and MCP discovery documents (Tested facts) |
| 4 | Research | LLM | One call with the provider's web search, told to prefer official docs and quote them verbatim; 150 s time box |
| 5 | Read sources | Code | The server fetches up to 8 cited pages itself, so quotes can be checked whichever provider ran |
| 6 | Write | LLM | A second call with **no tools** and a fixed JSON schema |
| 7 | Verify | Code | Probe the portal, docs and discovery endpoints the research found |
| 8 | Critic + coverage | Code | Check every quote against page text; count confirmed answers |
| 9 | Save | Code | Permalink `/apps/gen/<key>`, kept 7 days |

**Providers.** Claude, Gemini and GPT sit behind one interface in [`src/lib/llm/`](../src/lib/llm/):

- `research()` runs the provider's own web search: Claude web search and fetch, Gemini Google Search and URL context, GPT web search.
- `extract()` returns JSON for a given schema.

Only Claude returns the text of the pages it read, which is why stage 5 exists.

**When a key has no web search.** Free-tier Gemini keys have no Google Search on Gemini 3 models, so the first search is refused with HTTP 429.

1. Research retries on `gemini-2.5-flash`. Google's pricing page lists that model with free-tier Search.
2. If that is refused too, the model names the provider's official pages, the server reads them, and the guide is labelled "researched without web search".

`npm run check:key` shows which case a key falls into.

**Failure handling:**

- Anything that fails after research saves a **partial guide** with the sources and raw notes, never a finished one.
- The run continues if the browser closes (`after()`); duplicate requests attach to the running job.
- Provider errors are turned into plain messages: bad key, no quota on the plan, daily quota used, rate limit with retry time, overloaded.

**Streaming.** Progress goes to the browser as one JSON object per line, and every event is stored as the run log (`/api/runs/<id>`).

**Time budget:** the API route may run for 300 s. Stage limits are cut to fit a 280 s budget for the whole run, so a slow research stage leaves less time for writing rather than letting the host stop the run unsaved. A run still marked running after 6 minutes is reported as stopped.

**Limits:**

- 20 runs per network per hour.
- 150 runs a day on the site's own key; runs on a visitor's own key don't count toward this.
- One run per app at a time: a second request attaches to the running one.
- 20 key checks per network per hour; 60 "Agent can do" checks per network per hour.
- If a run fails while re-checking an app that already has a complete guide, the complete guide is kept.

**Storage:** Upstash Redis if configured, else local files in `.data/` (read through on every request, so guides from `npm run generate` appear without a restart), else memory. Upstash also holds the rate-limit counters, so on serverless hosts without it, limits count per instance.

## 5. Keeping the agent accurate

The model is not trusted to follow the steps; code runs them and checks what comes back.

| Control | How |
|---|---|
| Fixed order | The model is called in exactly two places and cannot skip, reorder or add stages. |
| Fixed output | JSON must parse, match the zod schema and pass cross-checks, or the guide is saved as partial. |
| The critic | Code, not a model. It labels each quote Unverified when the page was never read, was only a search result, or doesn't contain the quote. It relabels community sites Reported, and removes waits supported only by Unverified evidence. |
| Coverage | "N of 11 questions answered with a confirmed source" on every generated guide; under half shows **Needs review**. |
| Run log | Every search, page read, stage and error, linked from the guide. |
| Answer key | `npm run eval:agent` runs the agent cold on the 8 library apps and scores level range, level-deciding answers and gates against the researched guides. |

## 6. Safety and keys

- **Page content is data.** The call that writes the guide has no tools, and its output must match a schema. All text renders as text.
- **SSRF guard** on every server-side fetch of a user- or model-supplied URL:
  - http(s) only, on standard ports, to public IPs only
  - the address is checked at connect time, so DNS rebinding can't bypass it
  - redirects are re-checked
  - timeouts and size caps apply
- **Visitor API keys** are tested with a read-only call, then stored only in a cookie:
  - encrypted with AES-256-GCM under `APP_SECRET` (on Vercel the site refuses to store keys until it is set)
  - HttpOnly, SameSite=Strict, Secure on HTTPS, and scoped to `/api`
  - never written to storage, logged, or sent back; the browser only sees the provider, model and last four characters
  - kept until the browser closes, or 30 days if the visitor ticks Remember
  - key-setting and research endpoints reject cross-site requests, and a research page opened from another site waits for a click
- **Rate limits use the client IP** from `x-forwarded-for`. Vercel sets this header itself; behind your own proxy, make sure it overwrites the header, or limits can be bypassed.
- **The agent never acts as you:** no logins, payments, accepted terms or submitted reviews.
- **Headers:** a Content Security Policy in production; the page can only talk to its own origin.

## 7. Extending it

**Add a researched guide**

1. Write `src/data/guides/<slug>.json` against the schema. The brief in [`research/BRIEF.md`](research/BRIEF.md) is what the research agents followed.
2. Run `npm run validate -- <slug>`, then `npm run verify:sources -- <slug>`.
3. Run `npm run guides:index` (or restart `npm run dev`) to see it locally, then commit. The index, which skips guides that fail validation, is rebuilt before every `dev` and `build`.

**Add an LLM provider**

1. Implement `LlmProvider` from [`src/lib/llm/types.ts`](../src/lib/llm/types.ts):
   - `research(req)` streams searches and page reads through `req.emit` and returns notes and sources.
   - `extract(req)` returns JSON text for `req.schema`.
2. Throw `SearchUnavailableError` from `research` when the key cannot search.
3. Add the provider to `PROVIDERS` in [`catalog.ts`](../src/lib/llm/catalog.ts) (label, models, key URL, env var names, prices). Then wire it into `createProvider`, `describeProviderError` and `validateKey` in [`index.ts`](../src/lib/llm/index.ts).
4. Add a simulated-API test in `tests/api-sim.test.ts`.

**Tune without code changes:** see `.env.example`. It covers provider and model, research and extraction effort, search and page budgets, time limits, rate limits and how long guides are kept.

**Refresh Composio data:** `npm run data:sync`.

## 8. File map

```
src/lib/guide/       schema (the contract), scoring, verdict, intake (setup answers), view model, Markdown
src/lib/llm/         provider catalogue, adapters (anthropic, google, openai), prompts, key encryption
src/lib/agent/       pipeline, probes, critic, assemble, runs and rate limits, mock fixtures
src/lib/catalog.ts   Composio catalogue: lookup, search, aliases, ambiguity, redirect URI
src/lib/net/         SSRF-safe fetch, page-to-text
src/lib/store/       Upstash | file | memory
src/data/            Composio snapshot, researched guides, verification log
src/app/             pages and API routes
scripts/             validate, verify:sources, data:sync, check:key, generate / rehearse / eval, QA
tests/               scoring, verdicts, catalogue, critic, SSRF, pipeline, simulated provider APIs, key encryption
```
