import Link from "next/link";
import { AppIcon, DocsShell, Flow, H2, LevelRange, PageHeader } from "@/components/docs";
import { SearchBox } from "@/components/search";
import { catalogStats, snapshotDate } from "@/lib/catalog";
import { curatedGuides } from "@/lib/guides";
import { summarizeGuide } from "@/lib/guide/view";
import { VERDICT_SHORT } from "@/lib/guide/verdict";
import { recentGuides } from "@/lib/agent/runs";

export const dynamic = "force-dynamic";

const TOC = [
  { id: "answers", label: "What a guide answers" },
  { id: "flow", label: "How to use a guide" },
  { id: "guides", label: "Guides" },
  { id: "terms", label: "Key terms" },
  { id: "data", label: "Where the data comes from" },
];

const TERMS = [
  ["OAuth app", "The client you register with a provider (client ID, secret, redirect URI). Users approve access to it on a consent screen."],
  ["Managed app", "An OAuth app Composio has already registered. Fast to start, but the consent screen says Composio and quotas are shared."],
  ["Gate", "A review or verification the provider requires before external users can connect, such as app review or a security assessment."],
  ["Level", "1 to 4, set by the hardest gate on your path. Level 1 means no review; Level 4 means a third-party assessment or yearly review."],
  ["Path", "One route to production, such as 'own organisation only' or 'public app with marketplace listing'. Each has its own level."],
  ["Calendar wait", "How long gates take, from the provider's own sources. Separate from hands-on effort, which is our estimate."],
];

export default async function Overview() {
  const stats = catalogStats();
  const guides = curatedGuides().map((g) => ({ g, s: summarizeGuide(g) }));
  const recent = (await recentGuides()).slice(0, 8);
  return (
    <DocsShell active="/" toc={TOC}>
      <PageHeader
        title="OAuth Readiness"
        lead="Before your users can connect an app to your agent, you may need your own OAuth app, and the provider may need to approve it. Look up an app to see whether you need one, what approval it needs, how long that takes, and the exact steps."
      />
      <SearchBox />
      <p className="mt-2 text-sm text-fg-subtle">
        Try{" "}
        {["Gmail", "Slack", "Shopify", "Salesforce"].map((q, i) => (
          <span key={q}>
            {i > 0 && ", "}
            <Link href={`/go?q=${q}`} className="link">
              {q}
            </Link>
          </span>
        ))}
        , or an app that is not listed, like{" "}
        <Link href="/go?q=Jobber" className="link">
          Jobber
        </Link>
        .
      </p>

      <H2 id="answers">What a guide answers</H2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <thead>
            <tr>
              <th>Question</th>
              <th>Where to look in a guide</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="strong">Do I need my own OAuth app?</td>
              <td>Summary: the verdict</td>
            </tr>
            <tr>
              <td className="strong">How hard is it, and how long will it take?</td>
              <td>Summary: difficulty level, hands-on effort, calendar wait</td>
            </tr>
            <tr>
              <td className="strong">What exactly do I do?</td>
              <td>Setup steps, with the values to paste and who does each step</td>
            </tr>
            <tr>
              <td className="strong">How do I plug it into Composio?</td>
              <td>Connect to Composio: auth config and session code</td>
            </tr>
            <tr>
              <td className="strong">What will the provider review, and what can block me?</td>
              <td>Approval and timeline; Troubleshooting</td>
            </tr>
            <tr>
              <td className="strong">How do you know?</td>
              <td>Reference: sources, the 11 questions checked, open questions</td>
            </tr>
          </tbody>
        </table>
      </div>

      <H2 id="flow">How to use a guide</H2>
      <Flow
        steps={[
          { title: "1. Find the app", detail: "Search by name or website." },
          { title: "2. Set your setup", detail: "Who connects, what access, whose brand on the consent screen." },
          { title: "3. Read the summary", detail: "Verdict, level, effort, wait, values to copy." },
          { title: "4. Follow the steps", detail: "Register the app; submit reviews early." },
          { title: "5. Connect to Composio", detail: "Auth config and session code." },
        ]}
        caption="Reviews run in the background. Submit them on day one and keep building against test mode while you wait."
      />
      <p className="text-sm text-fg-muted">
        Each guide can be copied as Markdown, or as a prompt for a coding agent, so it can be handed to a teammate or to Claude or Cursor to implement.
      </p>

      <H2 id="guides" aside={`${guides.length} researched · ${stats.total.toLocaleString()} toolkits with a verdict`}>
        Guides
      </H2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <thead>
            <tr>
              <th>App</th>
              <th>Do I need my own app?</th>
              <th>Levels</th>
              <th>Verified</th>
            </tr>
          </thead>
          <tbody>
            {guides.map(({ g, s }) => (
              <tr key={g.slug}>
                <td className="strong">
                  <Link href={`/apps/${g.slug}`} className="flex items-center gap-2 no-underline hover:text-accent">
                    <AppIcon src={s.toolkit?.logo ?? g.app.logo} name={g.app.name} size={22} />
                    {g.app.name}
                  </Link>
                </td>
                <td>{VERDICT_SHORT[s.verdict.type]}</td>
                <td>
                  <LevelRange min={s.minLevel} max={s.maxLevel} />
                </td>
                <td className="whitespace-nowrap">{g.last_verified}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-fg-muted">
        Not listed? Every Composio toolkit has an instant verdict from Composio&apos;s data (
        <Link href="/apps" className="link">
          browse all
        </Link>
        ), and any other app can be researched live by the agent from the search box.
      </p>
      {recent.length > 0 && (
        <p className="mt-2 text-sm text-fg-subtle">
          Recently researched:{" "}
          {recent.map((r, i) => (
            <span key={r.key}>
              {i > 0 && ", "}
              <Link href={`/apps/gen/${r.key}`} className="link">
                {r.name}
              </Link>
            </span>
          ))}
        </p>
      )}

      <H2 id="terms" aside={<Link href="/concepts" className="link">All concepts</Link>}>
        Key terms
      </H2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[9rem_1fr]">
        {TERMS.map(([t, d]) => (
          <div key={t} className="contents">
            <dt className="text-sm font-medium text-fg">{t}</dt>
            <dd className="text-sm text-fg-muted">{d}</dd>
          </div>
        ))}
      </dl>

      <H2 id="data">Where the data comes from</H2>
      <p className="text-sm text-fg-muted">
        Composio&apos;s public toolkit data (versions up to {snapshotDate()}) lists {stats.total.toLocaleString()} toolkits. {stats.oauth2} use OAuth2: {stats.managed} have a Composio-managed app and {stats.byo} need you to bring your own. Another {stats.dcr} are MCP servers that register themselves. Provider requirements come from each provider&apos;s documentation, with every claim linked and dated. See{" "}
        <Link href="/method" className="link">
          Method
        </Link>{" "}
        and{" "}
        <Link href="/evidence" className="link">
          Evidence
        </Link>
        .
      </p>
    </DocsShell>
  );
}
