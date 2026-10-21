import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Callout, DecisionLadder, DocsShell, Flow, H2, LevelBadge, OwnerBadge, PageHeader } from "@/components/docs";

export const metadata: Metadata = { title: "Concepts and terms", description: "What a provider OAuth app is, how approval works, and every term used in the guides." };

const TOC = [
  { id: "layers", label: "How Composio connects users" },
  { id: "connect-flow", label: "What happens when a user connects" },
  { id: "verdict", label: "Do I need my own OAuth app?" },
  { id: "levels", label: "Levels and gates" },
  { id: "badges", label: "What the level leaves out" },
  { id: "effort", label: "Effort versus waiting" },
  { id: "evidence", label: "How sure we are" },
  { id: "owners", label: "Who does each step" },
  { id: "glossary", label: "Glossary" },
];

const GLOSSARY: [string, string][] = [
  ["Client ID and secret", "The identifier and password of your OAuth app. The secret stays on the server (Composio stores it in your auth config)."],
  ["Redirect URI", "Where the provider sends the user back after consent. It must match the registered value exactly. For Composio it is Composio's callback URL."],
  ["Scope", "A permission your app asks for, such as read mail or send mail. Scope choice often decides which review you face."],
  ["Consent screen", "The provider page where a user approves your app. It shows the app's name, so a managed app shows Composio."],
  ["Access and refresh tokens", "Short-lived and long-lived credentials Composio stores per user. Some providers expire refresh tokens in test mode."],
  ["PKCE", "A proof key that makes a stolen authorization code useless. Recommended for all OAuth clients."],
  ["Multi-tenant app", "An app users outside your own organisation can authorise. This is what triggers most reviews."],
  ["Admin consent", "A customer's administrator approves your app for their whole organisation, often required for sensitive permissions (Microsoft, Salesforce)."],
  ["Brand verification", "The provider checks your app name, logo, domain and privacy policy. Usually days."],
  ["Sensitive and restricted scopes", "Google's tiers. Sensitive scopes need a review with a demo video; restricted scopes also need a yearly security assessment."],
  ["CASA", "Cloud Application Security Assessment: Google's third-party security review for restricted scopes, done by a paid lab."],
  ["Publisher verification", "Microsoft's check that links your app to a verified Partner Center account, so tenants trust it."],
  ["Marketplace review", "Review to list in an app store (Slack Marketplace, Shopify App Store, AppExchange). Often required for production limits."],
  ["Dynamic Client Registration (DCR)", "The client registers itself through an API, so no one creates an OAuth app by hand. Common for MCP servers."],
  ["Client ID Metadata Document", "A newer MCP approach where the client's ID is a URL to its metadata. Also removes manual registration."],
  ["Auth config (ac_…)", "Composio's record of which OAuth app and scopes a toolkit uses. You pass its ID when you create a session."],
  ["Connected account", "One end user's connection, holding their tokens, created when they finish the Connect Link flow."],
  ["Connect Link", "Composio's hosted page that starts the OAuth flow for a user."],
];

function Layer({ title, holds, owner, last = false }: { title: string; holds: string; owner: string; last?: boolean }) {
  return (
    <div>
      <div className="grid gap-2 rounded-lg border border-border bg-bg-subtle p-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <div className="text-sm font-semibold text-fg">{title}</div>
          <div className="text-sm text-fg-muted">{holds}</div>
        </div>
        <div className="text-xs text-fg-subtle">{owner}</div>
      </div>
      {!last && (
        <div aria-hidden className="py-1 pl-6 text-fg-subtle">
          ↓
        </div>
      )}
    </div>
  );
}

export default function Concepts() {
  return (
    <DocsShell active="/concepts" toc={TOC}>
      <PageHeader
        crumbs={[{ label: "Get started" }, { label: "Concepts and terms" }]}
        title="Concepts and terms"
        lead="Read this once and every guide will make sense. It explains what an OAuth app is in Composio, how to tell whether you need your own, and what decides how long approval takes."
      />

      <H2 id="layers">How Composio connects users</H2>
      <p className="text-sm text-fg-muted">There are three layers. Whoever owns the top one owns the consent screen, the provider&apos;s review, and the rate-limit quota for everyone below it.</p>
      <figure className="my-5">
        <Layer title="Provider OAuth app" holds="Client ID and secret, redirect URI, approved scopes, name and logo" owner="Composio (managed) or you (bring your own)" />
        <Layer title="Composio auth config  ac_…" holds="Which OAuth app and scopes a toolkit uses in your project" owner="You, once per toolkit" />
        <Layer title="Connected accounts" holds="Each end user's tokens, stored and refreshed by Composio" owner="Each user, through a Connect Link" last />
      </figure>
      <Callout tone="neutral">
        Switching from Composio&apos;s managed app to your own affects new connections only. Existing users keep their old connection until they reconnect.
      </Callout>

      <H2 id="connect-flow">What happens when a user connects</H2>
      <Flow
        steps={[
          { title: "Agent needs access", detail: "A tool call needs the user's account." },
          { title: "Connect Link", detail: "Composio sends the user to the provider." },
          { title: "Consent screen", detail: "The user approves the scopes your app asks for." },
          { title: "Redirect URI", detail: "The provider returns to Composio's callback." },
          { title: "Tokens stored", detail: "The agent retries the tool call." },
        ]}
        caption="Approval gates sit before this flow: until the provider approves your app, external users either cannot finish step 3 or see a warning."
      />

      <H2 id="verdict">Do I need my own OAuth app?</H2>
      <p className="text-sm text-fg-muted">Every guide starts with this answer. It is computed from Composio&apos;s data and your setup, in this order:</p>
      <DecisionLadder
        rows={[
          { q: "Does the toolkit use OAuth?", exitOn: "No", exit: "No OAuth app needed (API key or similar)", tone: "ok" },
          { q: "Does it register clients itself (DCR, MCP servers)?", exitOn: "Yes", exit: "No app registration needed", tone: "ok" },
          { q: "Does Composio have a managed app for it?", exitOn: "No", exit: "Bring your own OAuth app now", tone: "bad" },
          { q: "Must users see your brand on the consent screen?", exitOn: "Yes", exit: "Start on the managed app; your own app before launch", tone: "warn" },
        ]}
        last={{ label: "Composio's managed app works (shared quota, Composio name on the consent screen)", tone: "ok" }}
      />

      <H2 id="levels">Levels and gates</H2>
      <p className="text-sm text-fg-muted">
        A <b className="text-fg">gate</b> is a review or check the provider runs before external users can connect. A path&apos;s <b className="text-fg">level</b> is its hardest gate. Levels are computed by code from the gates, never guessed.
      </p>
      <div className="my-4 overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <thead>
            <tr>
              <th>Level</th>
              <th>Gates that set it</th>
              <th>Typical wait</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <LevelBadge level={1} />
              </td>
              <td>None</td>
              <td>Same day</td>
            </tr>
            <tr>
              <td>
                <LevelBadge level={2} />
              </td>
              <td>Brand, publisher or domain verification; production approval after a user cap</td>
              <td>Days</td>
            </tr>
            <tr>
              <td>
                <LevelBadge level={3} />
              </td>
              <td>App review, sensitive-scope review, product-access application, marketplace listing</td>
              <td>1 to 8 weeks</td>
            </tr>
            <tr>
              <td>
                <LevelBadge level={4} />
              </td>
              <td>Third-party security assessment, or review that repeats every year</td>
              <td>Weeks to months, repeating</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-fg-muted">
        <b className="text-fg">L3+</b> means at least Level 3: an open question could raise it. The same app can sit on different levels depending on the path: Gmail is Level 1 inside your own Workspace and Level 4 with Composio&apos;s default scopes.
      </p>

      <H2 id="badges">What the level leaves out</H2>
      <p className="mb-3 text-sm text-fg-muted">Four things matter as much as review but are listed separately, so they are never hidden inside one number.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <tbody>
            {(
              [
                ["Cost", "warn", "Paid API tiers, listing or review fees, assessor fees"],
                ["Identity", "neutral", "Legal entity, verified domain, company page, partner programme, privacy policy"],
                ["After launch", "bad", "Rate limits for unlisted apps, install or user caps, token expiry, production windows"],
                ["Customer admin", "accent", "Each customer's admin must approve or install the app"],
              ] as const
            ).map(([k, tone, d]) => (
              <tr key={k}>
                <td className="w-40">
                  <Badge tone={tone}>{k}</Badge>
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="effort">Effort versus waiting</H2>
      <p className="text-sm text-fg-muted">
        <b className="text-fg">Hands-on effort</b> is the time you spend: our estimate, from fixed times per step type (create an app 15 min, write a justification 60 min, record a demo video 90 min). <b className="text-fg">Calendar wait</b> is the time the provider takes, taken only from sources. Gates that wait on each other add up; independent gates overlap. If no source states a timeline, the guide says so instead of guessing.
      </p>

      <H2 id="evidence">How sure we are</H2>
      <div className="my-4 overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <tbody>
            <tr>
              <td className="w-32">
                <Badge tone="ok">Tested</Badge>
              </td>
              <td>We or the agent ran it and saw the result, for example fetching a provider&apos;s discovery document.</td>
            </tr>
            <tr>
              <td>
                <Badge>Official</Badge>
              </td>
              <td>Stated in the provider&apos;s own documentation, linked, dated, with the exact quote. The default: citations show only a number.</td>
            </tr>
            <tr>
              <td>
                <Badge tone="warn">Reported</Badge>
              </td>
              <td>Community or third-party source. Useful for real-world timelines; may be dated.</td>
            </tr>
            <tr>
              <td>
                <Badge tone="bad">Unverified</Badge>
              </td>
              <td>Inferred, or the quote could not be found on its page. Treat it as a question to check.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-fg-muted">
        <b className="text-fg">Confidence</b> for a path is High when every gate claim is Official or Tested, Medium when some rely on community reports or official sources disagree, and Low when something that could change the level is unknown.
      </p>

      <H2 id="owners">Who does each step</H2>
      <div className="my-4 overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <tbody>
            {(
              [
                ["agent_done", "Already checked during research; the result and date are shown."],
                ["agent_can_do", "The page can run the check for you now (a URL loads, a redirect URI is valid, a discovery document exists)."],
                ["agent_drafts", "Copy-ready text or values: justification text, scope lists, messages to support. You paste and submit."],
                ["you", "Needs your login, money, legal identity, a video, or pressing Submit. Agents never act with your identity."],
              ] as const
            ).map(([o, d]) => (
              <tr key={o}>
                <td className="w-48">
                  <OwnerBadge owner={o} />
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="glossary">Glossary</H2>
      <dl className="divide-y divide-border rounded-lg border border-border">
        {GLOSSARY.map(([t, d]) => (
          <div key={t} className="grid gap-1 px-4 py-3 sm:grid-cols-[13rem_1fr] sm:gap-4">
            <dt className="text-sm font-medium text-fg">{t}</dt>
            <dd className="text-sm text-fg-muted">{d}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-sm text-fg-muted">
        Next: <Link href="/apps/gmail" className="link">read the Gmail guide</Link>, the clearest example of scope choice changing the level.
      </p>
    </DocsShell>
  );
}
