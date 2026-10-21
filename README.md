# OAuth Readiness

Before your users can connect an app to your AI agent through Composio, you may need your own OAuth app, and the provider may need to approve it. OAuth Readiness tells you, for any app:

- **Do I need my own OAuth app?**
- **How hard and how long?** A difficulty level, your hands-on effort and the calendar wait, kept separate.
- **What will block me?**
- **What can an agent do, and what must I do?**

Every claim is labelled Tested, Official, Reported or Unverified, and dated.

- **Live site:** _add the deployment URL here_
- **Library:** 8 researched guides (GitHub, Gmail, Slack, Shopify, LinkedIn, Salesforce, Microsoft Outlook, Xero), plus a verdict for all 1,608 Composio toolkits
- **Live research:** type any other app or website. An agent researches it while you watch and writes a guide in the same format, using Claude, Gemini or GPT.

**Docs:** [Using a guide](docs/GUIDE.md) (for engineers shipping an integration) · [How it works](docs/METHOD.md) (method, scoring, pipeline, extending) · [Plan](docs/PLAN.md) · [Use-case audit](docs/AUDIT.md)

---

## Quick start

You need [Node.js](https://nodejs.org) 20.12 or newer (22 LTS recommended) and npm.

```bash
git clone https://github.com/aayuk11/OAuth-Guide.git
cd OAuth-Guide
npm install
npm run dev
```

Open http://localhost:3000. The library, verdicts, scope advice, Markdown export and checks all work with no account and no key.

## Turn on live research

Live research needs an API key from one AI provider. There are two ways to add it.

**In the browser (easiest).** Click **AI key** in the header, pick Claude, Gemini or GPT, paste the key and click **Save and test**. The key is checked with a read-only call. It is then stored encrypted in an HttpOnly cookie that only this site's API can read, and never on the server.

**On the server.** Copy `.env.example` to `.env.local` and set one key:

```bash
GEMINI_API_KEY=...        # or ANTHROPIC_API_KEY=... or OPENAI_API_KEY=...
```

Restart `npm run dev`. If a visitor adds their own key in the browser, theirs is used instead.

**Check what a key can do** before a demo:

```bash
npm run check:key
```

It makes one tiny call per capability (key accepted, model answers, JSON output, web search). It prints the provider's own error text and a verdict, and never prints the key.

| Key | Live research |
|---|---|
| Claude (Anthropic) or GPT (OpenAI), pay as you go | Full: web search plus page reading. A run costs cents. |
| Gemini with billing enabled | Full |
| Gemini free tier | Limited. No Google Search on Gemini 3 models, so research falls back to `gemini-2.5-flash`, or to reading official pages by URL. Free models are sometimes overloaded. |

Then search for an app that has no guide (try "Jobber" or "Pipedrive") and click **Research the full guide**. A run takes 1–3 minutes. From the terminal: `npm run generate -- "Jobber"`.

## Using a guide

1. **Search** for the app.
2. **Answer the setup questions:** who connects, what access, whose brand. They change the verdict, path, level and wait, and they live in the URL, so shared links keep them.
3. **Read the summary:**
   - the verdict
   - the difficulty level (1–4)
   - hands-on effort and calendar wait
   - confidence
   - the redirect URI and scopes to copy
4. **Follow the setup steps.** Each says who does it: you, or an agent.
5. **Connect to Composio:** a custom auth config, plus session code in TypeScript and Python.
6. **Approval and timeline:** the gates in order, and what to do while you wait.
7. **Hand it on:** **Copy prompt for a coding agent** or **Copy as Markdown**.

The full walkthrough, with a worked Gmail example and a launch checklist, is in **[docs/GUIDE.md](docs/GUIDE.md)**.

## Deploy

The site needs a server: API routes, streaming, and runs of up to 300 s. GitHub Pages cannot host it; Vercel can, for free.

1. Push the repository to GitHub (CI in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs validate, lint, typecheck, tests and build).
2. On [vercel.com](https://vercel.com): **Add New → Project**, import the repository. Framework: Next.js; no build settings to change.
3. Add environment variables (Project → Settings → Environment Variables):

   | Variable | Needed? | Value |
   |---|---|---|
   | `APP_SECRET` | **Required** for the in-browser AI key | Any random string of 32+ characters: `openssl rand -hex 32` |
   | `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Recommended | The site's own key, so visitors without one can run research. Bounded by the rate limits below. |
   | `DAILY_RUN_CAP` | Optional | Runs per day on the site's key (default 150) |
   | Upstash Redis (Vercel → Storage → Upstash) | Recommended | Keeps generated guides and run logs across server instances. Without it, share links to generated guides can expire. |

4. Deploy. Every push to the main branch redeploys, and pull requests get preview URLs.

## Configuration

Every setting is an environment variable; [`.env.example`](.env.example) lists them all with defaults.

| Variable | Default | What it does |
|---|---|---|
| `LLM_PROVIDER` | first key set | `anthropic`, `google` or `openai`, when several keys are set |
| `LLM_MODEL` | provider default | `claude-sonnet-5-5`, `gemini-3.8-flash` or `gpt-6.1-sol` |
| `LLM_RESEARCH_EFFORT` / `LLM_EXTRACT_EFFORT` | `medium` / `low` | Reasoning effort for the two model calls |
| `MAX_SEARCHES` / `VERIFY_FETCHES` | 6 / 8 | Search budget; cited pages the server reads itself |
| `RESEARCH_TIMEOUT_MS` / `EXTRACT_TIMEOUT_MS` | 150000 / 110000 | Time boxes |
| `RUNS_PER_IP_PER_HOUR` / `DAILY_RUN_CAP` | 20 / 150 | Rate limits (the daily cap applies to the site's own key only) |
| `GUIDE_CACHE_DAYS` | 7 | How long generated guides are kept and reused |
| `APP_SECRET` | auto locally | Encrypts visitors' key cookies. Required in production. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` (or `KV_REST_API_*`) | none | Durable storage. Locally, `.data/` is used. |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run locally at http://localhost:3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run check:key [-- google gemini-3.8-flash]` | What the key in `.env.local` can do, with the provider's errors and a verdict |
| `npm run generate -- "App"` | One live research run in the terminal |
| `npm run rehearse` | 10 unfamiliar apps: time, cost, coverage and outcome → `docs/REHEARSAL.md` |
| `npm run eval:agent` | Run the agent cold on the 8 library apps and score it against the researched guides |
| `npm run validate` | Schema and cross-reference check of every researched guide |
| `npm run verify:sources` | Re-fetch every cited page and check each quote is still there (run it on a schedule) |
| `npm run data:sync` | Refresh the Composio catalogue |
| `npm test` / `npm run lint` / `npm run typecheck` | Tests (no key needed), lint, types |
| `npm run qa:keys` / `qa:overflow` / `qa:screens` | Browser checks: the key flow, phone-width overflow, screenshots |

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Add an AI key to research…" | No key in the browser or on the server. Add one under **AI key**, or set one in `.env.local` / Vercel. |
| "Web search is not available on this key's plan" / "Gemini is rate-limiting…" | Usually a free-tier Gemini key. Run `npm run check:key`; enable billing in Google AI Studio, or use a Claude or GPT key. |
| "This Gemini key's plan has no quota for …" | That model is not on the key's plan. Pick another model under **AI key**, or enable billing. |
| "Gemini is overloaded right now" | Google-side. Try again in a few minutes. |
| A generated guide's link shows "No saved guide" on Vercel | Add Upstash Redis so guides persist across server instances. |
| The AI key saves but stops working after a redeploy | `APP_SECRET` changed or is not set; set it once in Vercel and re-add the key. |
| `npm run generate` says no key | Scripts read `.env.local`; check the variable name (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`). |
| Port 3000 in use | `npm run dev -- -p 3001` |

---

## How it works

Models gather and draft; code decides. The verdict, level, wait, effort and confidence are computed from a guide's structured fields, so the same inputs always give the same answer.

1. **Identify** the app against Composio's catalogue.
2. **Probe** OAuth, OpenID and MCP discovery documents (Tested facts).
3. **Research** with the provider's web search.
4. **Read** the cited pages on our own server.
5. **Write** the guide against a fixed schema, with no tools.
6. **Check** every quote against the page it cites, and count how many of the 11 core questions have a confirmed source.
7. **Save** at a permalink.

Failures after research save a partial guide, never a finished one. Details, rules and how to extend it: **[docs/METHOD.md](docs/METHOD.md)**.

## Key decisions

| Decision | Why |
|---|---|
| **Lead with gates, not steps.** | Registering an app takes under an hour almost everywhere. Review, verification, assessments, partner programmes and caps are what turn an hour into weeks. |
| **Numbers are computed in code.** | The same gates always give the same answer; the model never writes the headline numbers. |
| **Effort and waiting are separate.** | "3 hours of work, then up to 10 business days of waiting" leads to a different plan than "two weeks". |
| **Scope choice is shown as the biggest lever.** | Composio's default Gmail scopes include `https://mail.google.com/`, which is restricted: a yearly paid security assessment. `gmail.send` alone is a review of days. |
| **Evidence on every claim, and a code critic.** | A quote must appear on the page it cites, or it is downgraded; community sites become Reported; timelines resting only on Unverified evidence are removed. |
| **Any LLM, two calls, code in charge.** | Research with the provider's web search; write the guide with no tools against a schema, so page text can never trigger an action. |
| **Bring your own key, in the browser.** | Nobody has to redeploy or hard-code a key to try live research. |
| **The agent never acts as you.** | Logging in, paying, accepting terms, recording a video and pressing Submit stay with you, and each step says so. |
| **Composio's own data drives the library.** | 1,608 toolkits (221 OAuth2: 122 managed, 99 bring-your-own; 99 MCP servers with dynamic registration) each get an instant verdict. The 99 bring-your-own toolkits are the queue for the next guides. |

## Verification

Full log in the app at `/evidence`; use-case audit in [docs/AUDIT.md](docs/AUDIT.md).

- **Sources.** The 8 researched guides cite 625 sources. On 2026-10-20, `npm run verify:sources` found **572 of 607 excerpts verbatim** on their pages.
  - 1 excerpt was not found; this is explained on the source.
  - 34 pages could not be fetched by script: Salesforce returns 403, Xero renders only in the browser, and Composio's dataset is too large. These were confirmed another way.
- **Tested.** 17 endpoint probes. For example, `mcp.notion.com` advertises self-registration; Google, Microsoft, Slack, LinkedIn and Xero do not.
- **Corrected** by research:
  - **Xero:** the 25-connection cap is gone; since March 2026 it depends on a paid tier.
  - **Microsoft:** 9 of Composio's 12 default Outlook scopes now need each customer's admin.
  - **Gmail:** brand verification must finish before scope review.
  - **Salesforce:** commercial use requires the ISV Partner Program.
  - **Slack:** unlisted apps read history at 1 request per minute.
  - **Composio:** the current callback is `v3`; `v1` is legacy.
- **Conflicts shown, not hidden.** Example: Google gives 3–5 versus 10 business days for sensitive-scope review. Guides show the range and mark confidence Medium.
- **Findings for Composio:**
  - The Shopify connection asks merchants for their shop domain, which App Store rule 2.3.1 forbids.
  - The Salesforce and Xero setup docs describe settings that no longer exist.
  - The default Gmail and Outlook scopes put a bring-your-own app on the slowest review path.
- **Not yet done.** Hands-on app creation with real provider accounts, so those claims stay Official rather than Tested. The agent's accuracy score (`npm run eval:agent`) also needs a key with web search.

## Limitations

- Live research has been tested in mock mode and against simulated APIs for all three providers. Key checks ran against the real Anthropic, Google and OpenAI APIs. Run `npm run check:key` and `npm run generate -- "Jobber"` with a real key before relying on it.
- Free-tier Gemini keys research with limited or no web search, so their guides cover less.
- Timelines belong to the providers and change. Check anything Reported or Unverified before committing to a date.
- Pages behind a login, or that render only in a browser, cannot be read; those claims stay Unverified.
- Generated guides are kept 7 days. Without Upstash on a serverless host, they can expire sooner.
- Not an official Composio product.

## Security

- No secrets in the repository; `.env*` is ignored except `.env.example`.
- Visitors' keys are encrypted (AES-256-GCM) in an HttpOnly, SameSite=Strict cookie scoped to `/api`. They are never stored, logged or returned.
- Every server-side fetch goes through an SSRF guard: public IPs only, checked at connect time, with redirects re-checked and timeouts and size caps.
- Page content is treated as data. Inputs are length-limited, runs are rate-limited, and production sends a Content Security Policy.

## What I would do next

1. Run `eval:agent` and `rehearse` on each provider, publish the accuracy score, and tune the research prompt on the misses.
2. Do the hands-on checks with real accounts and promote those claims to Tested.
3. Generate and review guides for the 99 bring-your-own toolkits, ranked by tool count times difficulty.
4. Schedule `verify:sources` weekly and flag drift; re-check Level 3–4 guides monthly.
5. Show the level and wait badges in Composio's dashboard at "use your own credentials", with a warning when default scopes trigger a slower review.
6. Expose guides as an MCP tool, so a coding agent can ask "what will Gmail approval take?"
