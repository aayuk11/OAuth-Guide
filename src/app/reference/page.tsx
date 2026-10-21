import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Badge, Callout, CodeBlock, DocsShell, H2, PageHeader } from "@/components/docs";

export const metadata: Metadata = { title: "API reference", description: "Use guides from code: JSON, Markdown, live research and checks." };

const TOC = [
  { id: "get-guide", label: "Get a guide" },
  { id: "get-markdown", label: "Get a guide as Markdown" },
  { id: "generate", label: "Research an app" },
  { id: "get-run", label: "Get a run" },
  { id: "checks", label: "Run a check" },
  { id: "search-index", label: "Search index" },
  { id: "agents", label: "Use with a coding agent" },
];

function Endpoint({ id, method, path, children }: { id: string; method: "GET" | "POST"; path: string; children: ReactNode }) {
  return (
    <section>
      <H2 id={id}>
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={method === "GET" ? "ok" : "accent"}>{method}</Badge>
          <code className="font-mono text-[1rem] font-medium">{path}</code>
        </span>
      </H2>
      <div className="space-y-3 text-sm text-fg-muted">{children}</div>
    </section>
  );
}

function Params({ rows }: { rows: [string, string, string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>In</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([n, where, t, d]) => (
            <tr key={n}>
              <td>
                <code className="font-mono text-xs text-fg">{n}</code>
              </td>
              <td>{where}</td>
              <td>
                <code className="font-mono text-xs">{t}</code>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const INTAKE: [string, string, string, string][] = [
  ["audience", "query", "own_org | external", "Who connects. Default: the guide's default, usually external."],
  ["access", "query", "read | write | admin", "Access the agent needs."],
  ["brand", "query", "yes | no", "Whether the consent screen must show your brand."],
  ["path", "query", "string", "Force a specific path id. Otherwise the best match for the answers above."],
];

export default function Reference() {
  return (
    <DocsShell active="/reference" toc={TOC}>
      <PageHeader
        crumbs={[{ label: "How it works" }, { label: "API reference" }]}
        title="API reference"
        lead="Everything on a guide page is available as JSON or Markdown, so it can power a docs badge, a dashboard hint, or a coding agent's tool. No authentication; live research is rate-limited."
      />
      <Callout tone="neutral" title="Keys">
        A key is a curated guide slug (<code className="inline">gmail</code>), a Composio toolkit slug with a curated guide, or a generated guide key from <code className="inline">/apps/gen/&lt;key&gt;</code>.
      </Callout>

      <Endpoint id="get-guide" method="GET" path="/api/guides/{key}">
        <p>Returns the guide plus the answer computed for the given setup: verdict, level, hands-on effort, calendar wait, confidence, and a summary of every path.</p>
        <Params rows={[["key", "path", "string", "Guide key."], ...INTAKE]} />
        <CodeBlock label="Request" code={`curl "https://<host>/api/guides/gmail?audience=external&access=write&brand=yes"`} />
        <CodeBlock
          label="Response (trimmed, illustrative values)"
          code={`{
  "url": "/apps/gmail",
  "computed": {
    "intake": { "audience": "external", "access": "write", "brand": true },
    "path": "send-only",
    "verdict": { "type": "managed_now_byo_later", "title": "Start on Composio's app now; your own app before launch" },
    "level": { "value": 3, "name": "Reviewed", "unconfirmed": false },
    "hands_on": { "minutes": 395, "label": "about 6½ h", "basis": "estimate" },
    "calendar_wait": { "min_business_days": 3, "max_business_days": 13, "label": "3–13 business days", "basis": "official", "open_ended": false },
    "confidence": { "value": "medium", "reasons": ["Official sources disagree on at least one number; the guide shows both."] },
    "paths": [{ "id": "internal", "label": "…", "level": 1, "wait": "Same day", "effort": "about 1½ h" }, …]
  },
  "guide": { "schema_version": 1, "slug": "gmail", "paths": […], "steps": […], "evidence": […] }
}`}
        />
        <p>
          Verdict types: <code className="inline">no_oauth</code>, <code className="inline">no_registration</code>, <code className="inline">managed_ok</code>, <code className="inline">managed_now_byo_later</code>, <code className="inline">byo_required</code>, <code className="inline">unknown</code>. The full guide schema is in <code className="inline">src/lib/guide/schema.ts</code>.
        </p>
      </Endpoint>

      <Endpoint id="get-markdown" method="GET" path="/api/guides/{key}/markdown">
        <p>The guide for the given setup as standalone Markdown, including sources and the legend. Add <code className="inline">download=1</code> to receive it as a file.</p>
        <Params rows={[["key", "path", "string", "Guide key."], ...INTAKE, ["download", "query", "1", "Send as an attachment."]]} />
        <CodeBlock label="Request" code={`curl "https://<host>/api/guides/shopify/markdown?audience=external" -o shopify.md`} />
      </Endpoint>

      <Endpoint id="generate" method="POST" path="/api/generate">
        <p>Starts live research and streams progress as newline-delimited JSON. The run continues if the client disconnects; reconnect with <code className="inline">GET /api/runs/&#123;id&#125;</code>.</p>
        <Params
          rows={[
            ["q", "body", "string", "App name or website (2–120 characters)."],
            ["toolkit", "body", "string", "Optional Composio toolkit slug, to skip name matching."],
            ["fresh", "body", "boolean", "Ignore a saved guide and research again."],
          ]}
        />
        <CodeBlock label="Request" code={`curl -N -X POST https://<host>/api/generate \\
  -H "content-type: application/json" \\
  -d '{"q":"Jobber"}'`} />
        <CodeBlock
          label="Stream (one JSON object per line)"
          code={`{"type":"run","id":"Hq0f900hKpJ7","key":"jobber","query":"Jobber","t":1}
{"type":"step","stage":"resolve","status":"done","detail":"Matched Composio toolkit \\"Jobber\\"","t":4}
{"type":"search","query":"Jobber OAuth app review requirements","t":5}
{"type":"read","url":"https://developer.getjobber.com/docs/…","title":"…","ok":true,"t":8120}
{"type":"finding","text":"api.getjobber.com: no registration_endpoint; PKCE: S256","label":"tested","t":9500}
{"type":"guide","key":"jobber","url":"/apps/gen/jobber","partial":false,"t":96000}
{"type":"done","url":"/apps/gen/jobber","t":96010}`}
        />
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["run", "Run created; keep the id to reconnect."],
                  ["step", "A stage changed status: resolve, composio, probe, research, extract, verify, critic, save."],
                  ["search / read", "A web search the agent ran, a page it read (or failed to read)."],
                  ["finding", "A tested fact from a probe."],
                  ["progress", "Free-text progress for the current stage."],
                  ["candidates", "The name is ambiguous; pick one and send its toolkit slug."],
                  ["redirect", "A saved guide exists; open the URL instead."],
                  ["attach", "The same app is already being researched; poll that run id."],
                  ["guide / done", "The guide is saved (partial: true when research did not finish)."],
                  ["error", "The run stopped; retryable says whether to try again."],
                ] as const
              ).map(([e, m]) => (
                <tr key={e}>
                  <td>
                    <code className="font-mono text-xs text-fg">{e}</code>
                  </td>
                  <td>{m}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Errors: <code className="inline">400</code> invalid input, <code className="inline">429</code> rate limit (20 runs per network per hour by default), <code className="inline">401</code> no AI key (add one under AI key, or set one on the server), <code className="inline">403</code> cross-site request.
        </p>
      </Endpoint>

      <Endpoint id="get-run" method="GET" path="/api/runs/{id}">
        <p>Status and every event of a run, for reconnecting after a closed tab or a dropped stream. Kept for 7 days.</p>
        <CodeBlock
          label="Response (trimmed, illustrative values)"
          code={`{
  "id": "Hq0f900hKpJ7", "key": "jobber", "query": "Jobber",
  "status": "done",              // running | done | partial | error
  "guideKey": "jobber",
  "events": [ … ],
  "usage": { "input_tokens": 84000, "output_tokens": 7000, "searches": 6, "fetches": 5, "cost_usd": 0.31 }
}`}
        />
      </Endpoint>

      <Endpoint id="checks" method="POST" path="/api/checks">
        <p>The &ldquo;Agent can do&rdquo; checks. Outbound requests go only to public addresses, with timeouts and size limits.</p>
        <Params
          rows={[
            ["kind", "body", "url_live | redirect_uri | oauth_discovery", "Which check to run."],
            ["value", "body", "string", "A URL, a redirect URI, or a provider or MCP host."],
          ]}
        />
        <CodeBlock label="Request" code={`curl -X POST https://<host>/api/checks -H "content-type: application/json" \\
  -d '{"kind":"oauth_discovery","value":"mcp.notion.com"}'`} />
        <CodeBlock label="Response" code={`{ "ok": true, "summary": "Self-registration available. mcp.notion.com: registration_endpoint: https://mcp.notion.com/register; PKCE: S256; Client ID Metadata Documents supported" }`} />
      </Endpoint>

      <Endpoint id="search-index" method="GET" path="/api/search-index">
        <p>Every Composio toolkit in a compact form for client-side search.</p>
        <CodeBlock label="Response (one item)" code={`{ "s": "shopify", "n": "Shopify", "k": "byo", "c": "ecommerce", "t": 407, "g": 1 }
// s slug · n name · k managed | byo | dcr | no_oauth · c category · t tool count · g has a researched guide`} />
      </Endpoint>

      <H2 id="agents">Use with a coding agent</H2>
      <p className="text-sm text-fg-muted">
        On any guide, <b className="text-fg">Copy prompt for a coding agent</b> copies the Markdown wrapped in instructions: list the console steps with exact values, write the Composio session code, list the approval gates, and flag anything unverified. Paste it into Claude, Cursor or another agent. The same Markdown is available from <code className="inline">/api/guides/&#123;key&#125;/markdown</code> for tools that fetch it directly.
      </p>
    </DocsShell>
  );
}
