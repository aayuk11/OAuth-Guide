import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Callout, DecisionLadder, DocsShell, Flow, H2, LevelBadge, PageHeader } from "@/components/docs";
import { agentConfig } from "@/lib/agent/config";
import { CORE_QUESTIONS, STEP_MINUTES } from "@/lib/guide/schema";
import { PROVIDER_IDS, PROVIDERS } from "@/lib/llm/catalog";

export const metadata: Metadata = { title: "Method", description: "How guides are researched, scored and checked." };

const TOC = [
  { id: "two-ways", label: "Two ways a guide is made" },
  { id: "pipeline", label: "Live research pipeline" },
  { id: "accuracy", label: "Keeping the agent on track" },
  { id: "critic", label: "The critic" },
  { id: "scoring", label: "How the numbers are computed" },
  { id: "freshness", label: "Keeping guides fresh" },
  { id: "safety", label: "Safety" },
  { id: "limits", label: "What it does not do" },
];

export default function Method() {
  const cfg = agentConfig();
  const providers = PROVIDER_IDS.map((p) => `${PROVIDERS[p].label} (${PROVIDERS[p].vendor})`).join(", ");
  const stages: [string, "Code" | "LLM", string, string][] = [
    ["Identify the app", "Code", "Match the name or website to Composio's catalogue; ask when ambiguous (Meta, Google).", "Toolkit or candidates"],
    ["Check Composio's catalogue", "Code", "Auth schemes, managed status, default scopes, per-user fields.", "Composio context"],
    ["Probe discovery endpoints", "Code", "Fetch OAuth, OpenID and MCP discovery documents when the domain is known.", "Tested facts"],
    ["Research the provider's docs", "LLM", `The model's own web search (about ${cfg.maxSearches} searches), ${Math.round(cfg.researchTimeoutMs / 1000)} s time box, official docs first.`, "Notes with quotes and URLs"],
    ["Read the sources", "Code", `The server fetches up to ${cfg.verifyFetches} cited pages itself, so quotes can be checked whichever model ran.`, "Page text"],
    ["Write the guide", "LLM", "A second call with no tools and a fixed JSON schema fills the guide format.", "Draft guide"],
    ["Test what was found", "Code", "Probe the portal, docs and discovery endpoints the research found.", "More tested facts"],
    ["Check every quote", "Code", "The critic (below) downgrades anything it cannot confirm.", "Checked guide"],
    ["Save and share", "Code", "Saved at a permalink; the run continues if the tab closes.", "Guide URL"],
  ];
  return (
    <DocsShell active="/method" toc={TOC}>
      <PageHeader
        crumbs={[{ label: "How it works" }, { label: "Method" }]}
        title="Method"
        lead="How guides are researched, how the numbers are computed, and how claims are checked. The model gathers and drafts; code decides the verdict, the level and the waits."
      />

      <H2 id="two-ways">Two ways a guide is made</H2>
      <h3 className="mb-1 mt-4 text-sm font-semibold text-fg">Researched guides (the library)</h3>
      <Flow
        steps={[
          { title: "Research", detail: "One research agent per app reads official docs and quotes them word for word.", tag: "LLM", tone: "accent" },
          { title: "Validate", detail: "The guide must pass the schema and cross-reference checks.", tag: "Code" },
          { title: "Re-verify sources", detail: "A script re-fetches every page and checks each quote is still there.", tag: "Code" },
          { title: "Review", detail: "Corrections, conflicts and open questions are logged.", tag: "Person", tone: "ok" },
        ]}
      />
      <h3 className="mb-1 mt-6 text-sm font-semibold text-fg">Live guides (any other app)</h3>
      <Flow
        steps={[
          { title: "Identify and probe", tag: "Code" },
          { title: "Research", tag: "LLM", tone: "accent" },
          { title: "Write", tag: "LLM", tone: "accent" },
          { title: "Test and critic", tag: "Code" },
          { title: "Save", tag: "Code" },
        ]}
        caption="Both produce the same guide format, so they can be compared, shared and checked the same way."
      />

      <H2 id="pipeline">Live research pipeline</H2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Stage</th>
              <th>Runs as</th>
              <th>What happens</th>
              <th>Output</th>
            </tr>
          </thead>
          <tbody>
            {stages.map(([s, who, what, out], i) => (
              <tr key={s}>
                <td>{i + 1}</td>
                <td className="strong">{s}</td>
                <td>
                  <Badge tone={who === "LLM" ? "accent" : "neutral"}>{who}</Badge>
                </td>
                <td>{what}</td>
                <td>{out}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-fg-muted">
        Any of {providers}, with the key a visitor adds under <b className="text-fg">AI key</b> or one set on the server. If the key&apos;s plan has no web search (free-tier Gemini keys), the model names the provider&apos;s official pages instead, the server reads them, and the guide says it was researched without search. Progress streams to the page as it happens. If anything fails after research, a partial guide is still saved with every source the agent read. Duplicate requests attach to the running job. Every guide answers the same {CORE_QUESTIONS.length} questions, so guides can be compared.
      </p>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-accent">The {CORE_QUESTIONS.length} questions</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-fg-muted">
          {CORE_QUESTIONS.map((q) => (
            <li key={q.id}>
              {q.text} {q.levelDeciding && <span className="text-xs text-fg-subtle">(can change the level)</span>}
            </li>
          ))}
        </ol>
      </details>

      <H2 id="accuracy">Keeping the agent on track</H2>
      <p className="text-sm text-fg-muted">The model is not trusted to follow the steps. Code runs them, and checks what the model returns.</p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <tbody>
            <tr>
              <td className="strong w-44">Fixed order</td>
              <td>Code calls each stage in turn. The model is called in exactly two places, and cannot skip, reorder or add stages.</td>
            </tr>
            <tr>
              <td className="strong">Fixed output</td>
              <td>The guide must match a JSON schema, then pass cross-reference checks. Anything that fails is saved as a partial guide, never as a finished one.</td>
            </tr>
            <tr>
              <td className="strong">Checked quotes</td>
              <td>The server reads the cited pages itself, and the critic looks for every quote on them.</td>
            </tr>
            <tr>
              <td className="strong">Coverage</td>
              <td>Each guide shows how many of the {CORE_QUESTIONS.length} questions have an answer with a confirmed source. Under half is flagged Needs review.</td>
            </tr>
            <tr>
              <td className="strong">Run log</td>
              <td>Every search, page and stage is recorded and linked from the guide.</td>
            </tr>
            <tr>
              <td className="strong">Answer key</td>
              <td>
                <code className="inline">npm run eval:agent</code> runs the agent cold on the library apps and scores it against the researched guides.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <H2 id="critic">The critic</H2>
      <p className="text-sm text-fg-muted">The critic is code, not a model, so it is deterministic and explainable. For every cited source:</p>
      <DecisionLadder
        rows={[
          { q: "Could the cited page be read?", exitOn: "No", exit: "Unverified", tone: "bad" },
          { q: "Is the quoted text on that page?", exitOn: "No", exit: "Unverified", tone: "bad" },
          { q: "Is the page a forum, blog or third party?", exitOn: "Yes", exit: "Reported", tone: "warn" },
        ]}
        last={{ label: "Official (as labelled)", tone: "ok" }}
      />
      <Callout tone="neutral">Then: any timeline whose only support is Unverified is removed, and the guide says there is no published timeline. The count of downgrades is shown on every generated guide.</Callout>

      <H2 id="scoring">How the numbers are computed</H2>
      <h3 className="mb-1 mt-4 text-sm font-semibold text-fg">Level</h3>
      <p className="text-sm text-fg-muted">
        The highest level among the gates on the selected path. No gates means <LevelBadge level={1} />. An open question that could raise it shows as L3+.
      </p>
      <h3 className="mb-1 mt-6 text-sm font-semibold text-fg">Calendar wait: worked example (Gmail, read access)</h3>
      <Flow
        steps={[
          { title: "Brand verification", detail: "0–3 business days", tag: "L2", tone: "accent" },
          { title: "Restricted-scope review", detail: "~6 weeks, starts after branding", tag: "L3", tone: "warn" },
          { title: "CASA assessment", detail: "No published timeline", tag: "L4", tone: "bad" },
          { title: "Total", detail: "6–7 weeks+, then yearly" },
        ]}
        caption="Gates that wait on each other add up; independent gates overlap. A gate with no published timeline makes the total open-ended (+)."
      />
      <h3 className="mb-1 mt-6 text-sm font-semibold text-fg">Hands-on effort</h3>
      <p className="text-sm text-fg-muted">
        Our estimate: fixed minutes per step type, summed for the path, plus Composio wiring. Examples: create an app {STEP_MINUTES.create_app} min, write a justification {STEP_MINUTES.write_justification} min, record a demo video {STEP_MINUTES.record_video} min, prepare for a security assessment {STEP_MINUTES.security_assessment / 60} h.
      </p>
      <h3 className="mb-1 mt-6 text-sm font-semibold text-fg">Confidence</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <tbody>
            <tr>
              <td className="w-28">
                <Badge tone="ok">High</Badge>
              </td>
              <td>Every gate claim and level-deciding answer is Official or Tested; no conflicts.</td>
            </tr>
            <tr>
              <td>
                <Badge tone="warn">Medium</Badge>
              </td>
              <td>Some claims rest on community reports, or official sources disagree (the full range is shown).</td>
            </tr>
            <tr>
              <td>
                <Badge tone="bad">Low</Badge>
              </td>
              <td>Something that could change the level is unknown or unverified, or the guide is partial.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <H2 id="freshness">Keeping guides fresh</H2>
      <Flow
        steps={[
          { title: "Re-verify on a schedule", detail: "npm run verify:sources" },
          { title: "Quote missing?", detail: "The page changed or moved." },
          { title: "Re-research", detail: "Run the agent, compare with the guide." },
          { title: "Update and re-date", detail: "Corrections logged on Evidence." },
        ]}
        caption="Provider rules changed in 2025–2026 for Xero, Microsoft, Salesforce, Slack and Shopify. Dated evidence makes stale claims visible."
      />

      <H2 id="safety">Safety</H2>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
        <li>Page content is treated as data. The call that writes the guide has no tools, so text on a fetched page cannot trigger an action, and its output must match a fixed schema.</li>
        <li>Every URL the server fetches for a user or the model is checked: public addresses only, checked at connect time, with timeouts and size caps.</li>
        <li>The agent never uses your identity: no logins, no payments, no accepted terms, no submitted reviews.</li>
        <li>Live runs are rate-limited per network, and runs on the site&apos;s own key per day.</li>
        <li>A visitor&apos;s API key is tested, then kept encrypted in an HttpOnly cookie. It is never stored on the server, logged or shown again.</li>
      </ul>

      <H2 id="limits">What it does not do</H2>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
        <li>Create provider accounts, accept terms, pay, or submit reviews for you.</li>
        <li>Promise review timelines. They belong to the providers; guides show what sources said, and when.</li>
        <li>Read pages behind a login or pages that render only in a browser. Those claims stay Unverified.</li>
      </ul>
      <p className="mt-6 text-sm text-fg-muted">
        See <Link href="/evidence" className="link">Evidence</Link> for what was verified and corrected, and the <Link href="/reference" className="link">API reference</Link> to use guides from code.
      </p>
    </DocsShell>
  );
}
