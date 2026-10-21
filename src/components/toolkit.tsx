import Link from "next/link";
import { siblings, toolkitKind, type Toolkit } from "@/lib/catalog";
import { COMPOSIO_EVIDENCE, toolkitDataEvidence } from "@/lib/composio-evidence";
import type { Intake } from "@/lib/guide/intake";
import { computeVerdict } from "@/lib/guide/verdict";
import { wiringSteps } from "@/lib/guide/view";
import type { Evidence } from "@/lib/guide/schema";
import { AgentCheck, SetupBar, Tabs } from "./client";
import { AppIcon, Badge, Callout, Cite, CodeBlock, Disclosure, H2, OwnerBadge, PageHeader, type EvidenceIndex, type TocItem } from "./docs";

const KIND_TEXT = {
  managed: "Composio has a managed OAuth app",
  byo: "No managed app: bring your own",
  dcr: "MCP server that registers clients itself (DCR)",
  no_oauth: "Connects without OAuth",
} as const;

export const TOOLKIT_TOC: TocItem[] = [
  { id: "summary", label: "Summary" },
  { id: "composio-data", label: "Composio data" },
  { id: "composio", label: "Connect to Composio" },
];

export function ToolkitPage({ toolkit, intake, generated }: { toolkit: Toolkit; intake: Intake; generated: { key: string; partial: boolean; date: string } | null }) {
  const kind = toolkitKind(toolkit);
  const verdict = computeVerdict({ toolkit, guide: null, intake, appName: toolkit.name });
  const ev: Evidence[] = [toolkitDataEvidence(toolkit), ...COMPOSIO_EVIDENCE];
  const index: EvidenceIndex = Object.fromEntries(ev.map((e, i) => [e.id, { n: i + 1, e }]));
  const wiring = kind === "managed" || kind === "byo" ? wiringSteps(toolkit, toolkit.name) : [];
  const sib = siblings(toolkit);
  const research = `/generate?q=${encodeURIComponent(toolkit.name)}&toolkit=${encodeURIComponent(toolkit.slug)}`;
  const scopes = toolkit.oauth?.scopes ?? toolkit.dcr?.scopes ?? [];

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/apps", label: "Guides" }, { label: toolkit.name }]}
        title={
          <span className="flex items-center gap-3">
            <AppIcon src={toolkit.logo} name={toolkit.name} size={36} />
            {toolkit.name}
          </span>
        }
        lead={toolkit.description}
        meta={
          <>
            <span>From Composio&apos;s toolkit data</span>
            <span aria-hidden>·</span>
            <span>
              Toolkit <code className="inline">{toolkit.slug}</code>
            </span>
            <span aria-hidden>·</span>
            <span>{toolkit.tools} tools</span>
          </>
        }
      />

      {(kind === "managed" || kind === "byo") && (
        <div className="mb-4">
          <SetupBar key={`${intake.audience}-${intake.access}-${intake.brand}`} base={`/apps/${toolkit.slug}`} audience={intake.audience} access={intake.access} brand={intake.brand} pathId="" paths={[]} />
        </div>
      )}

      <section id="summary" className="scroll-mt-20 overflow-hidden rounded-lg border border-border">
        <div className="p-4 sm:p-5">
          <div className="text-xs text-fg-subtle">Do I need my own OAuth app?</div>
          <p className="mt-1 text-lg font-semibold text-fg">{verdict.title}</p>
          <p className="mt-1 text-sm text-fg-muted">{verdict.summary}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
            {verdict.reasons.map((r, i) => (
              <li key={i}>
                {r.text}
                {r.evidence && r.evidence.length > 0 && <Cite ids={r.evidence} index={index} />}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3 border-t border-border bg-bg-subtle p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <p className="text-sm text-fg-muted">No researched guide for {toolkit.name} yet, so review gates, timelines and blockers are not shown.</p>
          <div className="flex shrink-0 gap-2">
            {generated && (
              <Link href={`/apps/gen/${generated.key}`} className="rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg no-underline hover:border-border-strong">
                View generated guide{generated.partial ? " (partial)" : ""}
              </Link>
            )}
            <Link href={`${research}${generated ? "&fresh=1" : ""}`} className="rounded-md bg-fg px-3 py-1.5 text-sm font-medium text-bg no-underline hover:opacity-90">
              {generated ? "Research again" : "Research the full guide"}
            </Link>
          </div>
        </div>
      </section>

      <H2 id="composio-data">Composio data</H2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <tbody>
            <tr>
              <td className="strong w-48">Auth schemes</td>
              <td>
                <code className="font-mono text-xs">{toolkit.auth.join(", ") || "none"}</code>
                <Cite ids={["cx-data"]} index={index} />
              </td>
            </tr>
            <tr>
              <td className="strong">OAuth app</td>
              <td>{KIND_TEXT[kind]}</td>
            </tr>
            {toolkit.oauth?.extra_config.length ? (
              <tr>
                <td className="strong">Extra auth config fields</td>
                <td>{toolkit.oauth.extra_config.map((f) => f.label).join(", ")}</td>
              </tr>
            ) : null}
            {toolkit.oauth?.connection_fields.length ? (
              <tr>
                <td className="strong">Asked of each user</td>
                <td>
                  {toolkit.oauth.connection_fields.map((f) => (
                    <div key={f.name}>
                      <span className="text-fg">{f.label}</span>
                      {f.required ? " (required)" : ""}
                      {f.description ? <span className="text-fg-subtle">: {f.description}</span> : null}
                    </div>
                  ))}
                </td>
              </tr>
            ) : null}
            {scopes.length > 0 && (
              <tr>
                <td className="strong">Default scopes ({scopes.length})</td>
                <td>
                  <code className="break-all font-mono text-xs text-fg">{scopes.join(" ")}</code>
                  <div className="mt-1 text-xs text-fg-subtle">Which of these trigger review is not classified until the app is researched.</div>
                </td>
              </tr>
            )}
            {sib.length > 0 && (
              <tr>
                <td className="strong">Related toolkits</td>
                <td>
                  {sib.map((s) => (
                    <Link key={s.slug} href={`/apps/${s.slug}`} className="link mr-3">
                      {s.name}
                    </Link>
                  ))}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {kind === "dcr" && (
        <Callout tone="ok" title="Check the discovery document">
          The MCP server should advertise a <code className="inline">registration_endpoint</code> in its OAuth metadata. Enter its host to see what it advertises now.
          <AgentCheck kind="oauth_discovery" placeholder="e.g. mcp.notion.com" />
        </Callout>
      )}

      {wiring.length > 0 && (
        <>
          <H2 id="composio">Connect to Composio</H2>
          <p className="mb-5 text-sm text-fg-muted">If you bring your own app: register it with the provider, then create a custom auth config.</p>
          <ol className="space-y-6">
            {wiring.map((w, i) => {
              const code = w.paste?.filter((p) => p.label === "TypeScript" || p.label === "Python") ?? [];
              const values = w.paste?.filter((p) => !code.includes(p)) ?? [];
              return (
                <li key={w.id} className="grid grid-cols-[1.75rem_1fr] gap-x-3">
                  <span className="grid h-7 w-7 place-items-center rounded-full border border-border-strong text-xs font-medium text-fg-muted">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="text-[0.95rem] font-semibold text-fg">{w.title}</h3>
                      <OwnerBadge owner={w.owner} />
                      <Cite ids={w.evidence} index={index} />
                    </div>
                    <p className="mt-1 text-sm text-fg-muted">{w.detail}</p>
                    <div className="mt-2 space-y-2">
                      {values.map((p) => (
                        <CodeBlock key={p.label} label={p.label} code={p.value} />
                      ))}
                      {code.length > 0 && <Tabs tabs={code.map((p) => ({ label: p.label, content: <CodeBlock code={p.value} /> }))} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <div className="mt-10">
        <Disclosure title="Sources" meta={`${ev.length}`} id="sources">
          <ol className="space-y-2">
            {ev.map((e, i) => (
              <li key={e.id} id={`src-${e.id}`} className="scroll-mt-24">
                <span className="text-xs text-fg-subtle">[{i + 1}]</span> <Badge>{e.label}</Badge>{" "}
                <a href={e.url ?? "#"} target="_blank" rel="noreferrer noopener" className="link">
                  {e.title}
                </a>{" "}
                <span className="text-xs text-fg-subtle">read {e.retrieved}</span>
                {e.excerpt && <p className="mt-1 border-l-2 border-border pl-3 text-xs text-fg-muted">“{e.excerpt}”</p>}
              </li>
            ))}
          </ol>
        </Disclosure>
      </div>
    </>
  );
}
