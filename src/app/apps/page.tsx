import type { Metadata } from "next";
import { DocsShell, PageHeader } from "@/components/docs";
import { LibraryList, type LibraryRow } from "@/components/library";
import { allToolkits, catalogStats, snapshotDate, toolkitKind } from "@/lib/catalog";
import { curatedGuides } from "@/lib/guides";
import { summarizeGuide } from "@/lib/guide/view";

export const metadata: Metadata = {
  title: "All toolkits",
  description: "Every Composio toolkit that uses OAuth or self-registration, with whether you need your own OAuth app.",
};

export default async function Library({ searchParams }: PageProps<"/apps">) {
  const sp = await searchParams;
  const f = typeof sp.f === "string" ? sp.f : "oauth";
  const curated = new Map(curatedGuides().map((g) => [g.composio_slug, summarizeGuide(g)]));
  const rows: LibraryRow[] = allToolkits()
    .filter((t) => toolkitKind(t) !== "no_oauth")
    .map((t) => {
      const s = curated.get(t.slug);
      return {
        slug: t.slug,
        name: t.name,
        logo: t.logo,
        category: t.category,
        kind: toolkitKind(t),
        tools: t.tools,
        apiKey: t.auth.includes("API_KEY"),
        curated: s ? { min: s.minLevel, max: s.maxLevel } : null,
      };
    })
    .sort((a, b) => Number(!!b.curated) - Number(!!a.curated) || b.tools - a.tools);
  const stats = catalogStats();
  return (
    <DocsShell active="/apps" wide>
      <PageHeader
        crumbs={[{ label: "Guides" }, { label: "All toolkits" }]}
        title="All toolkits"
        lead={`${stats.oauth2} Composio toolkits use OAuth2: ${stats.managed} have a managed app, ${stats.byo} need you to bring your own. ${stats.dcr} MCP servers register themselves. Researched guides are listed first; every other toolkit shows Composio's data and can be researched live.`}
        meta={<span>Composio toolkit data, versions up to {snapshotDate()}. API-key-only toolkits are searchable but not listed.</span>}
      />
      <LibraryList rows={rows} initialFilter={["oauth", "managed", "byo", "dcr", "guides"].includes(f) ? (f as "oauth") : "oauth"} />
    </DocsShell>
  );
}
