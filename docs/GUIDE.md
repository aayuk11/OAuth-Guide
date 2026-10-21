# Shipping an OAuth integration with a guide

For engineers connecting a third-party app (Gmail, Slack, Salesforce…) to their product through Composio, so their users can sign in with that app. A guide tells you, before you write code: do you need your own OAuth app, which approvals it needs and how long they take, what you must do yourself, and how to wire it into Composio.

How the guides are produced and how every number is computed: [METHOD.md](METHOD.md).

## Contents

1. [Find the app](#1-find-the-app)
2. [Describe your setup](#2-describe-your-setup)
3. [Read the summary](#3-read-the-summary)
4. [Do the setup steps](#4-do-the-setup-steps)
5. [Wire it into Composio](#5-wire-it-into-composio)
6. [Get through approval](#6-get-through-approval)
7. [When something breaks](#7-when-something-breaks)
8. [How much to trust a claim](#8-how-much-to-trust-a-claim)
9. [Use guides from code or a coding agent](#9-use-guides-from-code-or-a-coding-agent)
10. [Worked example: Gmail](#10-worked-example-gmail)
11. [Launch checklist](#11-launch-checklist)

## 1. Find the app

Type the app's name or website in the search box. You land on one of three pages:

| Page | URL | What it has |
|---|---|---|
| Researched guide | `/apps/<app>` | The full guide, checked against sources. 8 apps: GitHub, Gmail, Slack, Shopify, LinkedIn, Salesforce, Microsoft Outlook, Xero. |
| Toolkit page | `/apps/<toolkit>` | Any of Composio's 1,608 toolkits: the verdict, default scopes and the Composio wiring, from Composio's own data. No approval details. Use **Research the full guide** to get them. |
| Generated guide | `/apps/gen/<key>` | Written by the research agent for any other app, in the same format. Read [section 8](#generated-guides) before relying on one. |

If a name is ambiguous ("Meta", "Microsoft"), you are asked which product you mean.

## 2. Describe your setup

Four answers at the top of every guide change the verdict, the path, the level and the wait. They are saved in the URL, so a link you share opens with your answers.

| Question | Options | Why it matters |
|---|---|---|
| Who connects | Only my organisation · External customers | Most reviews apply only when users outside your organisation authorize the app. |
| Access needed | Read · Write or send · Admin / full access | Scope tiers drive review: reading Gmail needs a security assessment, sending does not. |
| Consent screen shows | Your brand · Composio is fine | Composio's managed app shows "Composio". Your brand means your own OAuth app. |
| Path | The routes to production for this app | Picked for you from the answers above; change it to compare. |

## 3. Read the summary

Read it top to bottom. Everything in it is computed by code from the guide's gates, steps and sources, so the same answers always give the same result.

**Verdict: do you need your own OAuth app?**

| Verdict | What to do |
|---|---|
| No OAuth app needed | The toolkit uses an API key or another credential. Each user supplies their own. |
| No app registration needed | The app's MCP server lets clients register themselves (dynamic client registration). Users still approve on the consent screen. |
| Composio's managed app works | Use it. Check the listed limits: "Composio" on the consent screen, shared rate limits, polling triggers at most every 15 minutes, default scopes only. |
| Managed now, your own app before launch | Build and test on the managed app today. Start your own app's approval in parallel so it is ready for launch. |
| Bring your own OAuth app | No managed app exists. Register one with the provider, then create a custom auth config. |
| Not yet known | The app is not in Composio's catalogue and research could not confirm how it authenticates. |

**Difficulty level:** the hardest gate on your path.

| Level | Name | Means | Typical gates |
|---|---|---|---|
| 1 | Self-serve | No review of any kind | none |
| 2 | Light check | Automated or light human check, usually under a week | brand, publisher, domain verification; production approval |
| 3 | Reviewed | Human review of your app, a product-access application or a listing | app review, sensitive-scope review, product access, marketplace listing |
| 4 | Heavy | Third-party security assessment, or review that recurs every year | security assessment, annual re-verification |

"L3+" or "could be higher" means an open question could raise the level.

**Hands-on effort and calendar wait** are separate on purpose. Effort is the time you spend working: our estimate per step type. Wait is the time you spend waiting for the provider, and it comes only from what sources say.

- Gates that depend on each other add up; independent gates overlap.
- `+` means at least one gate has no published timeline, so the total is open-ended.
- "then yearly" means a gate recurs.

**Confidence**

| Confidence | Means |
|---|---|
| High | Every gate claim and level-deciding answer is backed by the provider's own docs or our own test. |
| Medium | Some claims rest on community reports, or official sources disagree (the guide shows the full range). |
| Low | Something that could change the level is unknown or unsupported, or the guide is partial. |

Below the numbers: the **redirect URI and scopes to copy**, and the first actions.

## 4. Do the setup steps

Steps are numbered in order, with the time each takes and copy-ready values. When a step differs by path, it has tabs pre-selected for your setup. Tick steps off as you go; progress is saved in your browser.

Every step says who does it:

| Owner | Means |
|---|---|
| You | Needs your login, payment, legal identity, a video, or pressing Submit. |
| Agent can do | A check a tool can run for you: a URL is live, a redirect URI is well formed, a discovery document exists. Some run right on the page. |
| Agent drafts | Text or values you paste and submit: justifications, privacy-policy wording, session code. |
| Agent done | Already established by our own tests. |

**Scopes are the biggest lever.** Ask only for what your agent needs. Composio's default Gmail scopes include `https://mail.google.com/`, which is restricted: a yearly paid security assessment. `gmail.send` alone is a sensitive scope with a review of days, not weeks. The guide warns when Composio's defaults put you on a slower path.

## 5. Wire it into Composio

Once you have a client ID and secret:

1. **Register the redirect URI in the provider's console, exactly:**

   ```
   https://backend.composio.dev/api/v3/toolkits/auth/callback
   ```

   It must match your Composio auth config character for character; a mismatch is the most common setup error. Some toolkits still default to Composio's legacy `v1` callback; the guide shows it when that applies.

2. **Create a custom auth config:** Composio dashboard → Create Auth Config → the toolkit → OAuth2 → paste the client ID and secret, plus any extra fields the guide lists. Set the scopes your path needs, not the defaults. Copy the auth config ID (`ac_…`).

3. **Pass the auth config ID when you create a session.** Creating it is not enough. Toolkits you leave out keep using Composio's managed auth.

   ```ts
   const session = await composio.create("user_123", {
     authConfigs: { gmail: "ac_your_config_id" },
   });
   ```

   ```python
   session = composio.create(
       user_id="user_123",
       auth_configs={"gmail": "ac_your_config_id"},
   )
   ```

4. **Collect per-user fields** if the guide lists any (for example a Shopify store's subdomain). Ask for them before sending the Connect Link.

5. **Plan the switch for existing users.** A new auth config applies to new connections only. Users connected through the managed app keep that connection until they reconnect, so prompt them.

## 6. Get through approval

The **Approval and timeline** section lists the gates on your path in order, what each needs, how long sources say it takes, and the evidence.

- **Start the slowest gate first.** The calendar wait, not the work, decides your launch date.
- **While you wait,** build and test on Composio's managed app if one exists, or with test users in the provider's test mode (the guide lists test-mode limits: test users, token expiry, rate limits).
- **Check the badges.** They cover cost (paid tier, assessor fees), identity (legal entity, verified domain, privacy policy), after-launch limits (caps, rate penalties) and customer-admin steps (admin consent, org-owner approval).
- **Compare paths.** A narrower path (fewer scopes, internal only, a different distribution model) is often weeks faster.

## 7. When something breaks

**Troubleshooting** has one entry per common failure. Each gives:

- the symptom you see
- the cause
- how to unblock today
- the proper fix
- where to escalate, with a drafted message you can send

## 8. How much to trust a claim

Every claim has a footnote. Open **Reference → Sources** for the quote, the page and the date it was read.

| Label | Means | Before you commit to a date |
|---|---|---|
| Tested | We checked it ourselves (a discovery document, a URL, a redirect URI) | Safe |
| Official | The provider's own documentation, quoted | Safe; rules change, so check the date |
| Reported | Forums, blogs, third parties | Treat as a hint; confirm it |
| Unverified | No source could be confirmed | Confirm it yourself |

Provider rules changed in 2025–2026 for Xero, Microsoft, Salesforce, Slack and Shopify, which is why every source carries the date it was read.

### Generated guides

Guides from the research agent are not reviewed by a person. The box at the top tells you how far to trust one:

- **"N of 11 core questions answered with a confirmed source."** Under half is flagged **Needs review**.
- **Quotes confirmed:** how many quotes the critic found on the pages cited. Quotes it could not find are downgraded to Unverified.
- **Researched without web search:** the API key's plan did not include web search, so only pages the model named were read. Expect gaps.
- **Run log:** every search, page read and stage of the run.
- **Partial guide:** the run stopped early. The research notes are kept, and **Re-check** runs it again.

## 9. Use guides from code or a coding agent

**From a coding agent:** on any guide, **Copy prompt for a coding agent** copies the guide as Markdown, wrapped in instructions:

- list the console steps with exact values
- write the Composio session code
- list the approval gates
- flag anything unverified

Paste it into Claude Code, Cursor or another agent. **Copy as Markdown** gives the same content for a ticket or a doc.

**From code:** all endpoints are documented at `/reference` on the site.

```bash
# The guide plus the computed verdict, level, effort, wait and confidence for your setup
curl "https://<host>/api/guides/gmail?audience=external&access=write&brand=yes"

# The same as standalone Markdown (add &download=1 for a file)
curl "https://<host>/api/guides/gmail/markdown?audience=external&access=write&brand=yes"

# Run a check the agent would run: redirect_uri, url_live or oauth_discovery
curl -X POST "https://<host>/api/checks" -H "content-type: application/json" \
  -d '{"kind":"oauth_discovery","value":"mcp.notion.com"}'
```

Setup parameters: `audience=own_org|external`, `access=read|write|admin`, `brand=yes|no`, and optionally `path=<path id>`.

`POST /api/generate` starts live research and streams progress as one JSON object per line. Called from a server, it uses the deployment's own API key.

## 10. Worked example: Gmail

The same app, three setups (from the researched Gmail guide):

| Setup | Path | Verdict | Level | Calendar wait | Hands-on effort | Confidence |
|---|---|---|---|---|---|---|
| Own organisation, read, Composio is fine | Your own Workspace organisation only | Composio's managed app works | 1 Self-serve | Same day | about 1½ h | High |
| External, write/send, your brand | Send email only (`gmail.send`) | Managed now, your own app before launch | 3 Reviewed | 3–13 business days | about 6½ h | Medium |
| External, read, your brand | Read email (`gmail.readonly`) | Managed now, your own app before launch | 4 Heavy | 6–7 weeks+, then yearly | about 2 working days | High |

Why the read path is Level 4:

1. **Brand verification:** 0–3 business days.
2. **Restricted-scope review,** which starts only after branding: about 6 weeks.
3. **Security assessment** by an authorised lab: no published timeline (hence the `+`).
4. **Re-verification every year** (hence "then yearly").

The send-only path is Medium confidence because two Google pages disagree: 3–5 versus 10 business days. The guide shows the full range rather than picking one.

**What this means:** if your agent only needs to send email, ask for `gmail.send` and ship in about two weeks. If it must read mail, start brand verification on day one and build on Composio's managed app meanwhile; don't use Composio's default scopes for your own app.

## 11. Launch checklist

- [ ] Setup answers are right (who connects, access, brand), and the path matches what you will ship.
- [ ] Scopes are the minimum your agent needs; Composio's defaults are not copied blindly.
- [ ] Redirect URI is identical in the provider's console and your Composio auth config.
- [ ] Custom auth config created, and its `ac_…` ID passed in `composio.create(...)`.
- [ ] Every gate on the path is submitted; the slowest one started first.
- [ ] Badges handled: legal entity, verified domain, privacy policy, fees, admin consent.
- [ ] Test-mode limits known (test users, token expiry) for your beta.
- [ ] Existing users on the managed app have a reconnect plan.
- [ ] Anything Reported or Unverified on your path has been confirmed.
