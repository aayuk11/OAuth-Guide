import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuideActions } from "@/components/client";
import { AppIcon, DocsShell, PageHeader } from "@/components/docs";
import { GUIDE_TOC, GuideBody } from "@/components/guide";
import { ToolkitPage, TOOLKIT_TOC } from "@/components/toolkit";
import { getToolkit, toolkitKind } from "@/lib/catalog";
import { curatedForToolkit, getCuratedGuide } from "@/lib/guides";
import { intakeQuery, parseIntake } from "@/lib/guide/intake";
import { LEVEL_NAMES } from "@/lib/guide/scoring";
import { VERDICT_SHORT } from "@/lib/guide/verdict";
import { buildView, summarizeGuide } from "@/lib/guide/view";
import { guideKeyFor } from "@/lib/agent/pipeline";
import { getGeneratedGuide } from "@/lib/agent/runs";

function lookup(slug: string) {
  const guide = getCuratedGuide(slug) ?? curatedForToolkit(slug);
  const toolkit = getToolkit(guide?.composio_slug ?? slug);
  return { guide, toolkit };
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export async function generateMetadata({ params }: PageProps<"/apps/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const { guide, toolkit } = lookup(slug);
  if (guide) {
    const s = summarizeGuide(guide);
    const lvl = s.minLevel === s.maxLevel ? `Level ${s.minLevel} (${LEVEL_NAMES[s.minLevel]})` : `Level ${s.minLevel}–${s.maxLevel} depending on path`;
    const title = `${guide.app.name}: OAuth app setup and approval`;
    const description = `${VERDICT_SHORT[s.verdict.type]}. ${lvl}. ${guide.headline} Verified ${guide.last_verified}.`;
    return { title, description, openGraph: { title, description }, twitter: { card: "summary", title, description } };
  }
  if (toolkit) return { title: `${toolkit.name}: OAuth app setup`, description: `Do you need your own OAuth app for ${toolkit.name}? Verdict from Composio's toolkit data.` };
  return { title: "Not found" };
}

export default async function AppPage({ params, searchParams }: PageProps<"/apps/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { guide, toolkit } = lookup(slug);
  if (!guide && !toolkit) notFound();

  if (!guide) {
    const key = guideKeyFor(toolkit!.name, toolkit);
    const gen = await getGeneratedGuide(key).catch(() => null);
    return (
      <DocsShell active="/apps" toc={TOOLKIT_TOC.filter((t) => t.id !== "composio" || ["managed", "byo"].includes(toolkitKind(toolkit!)))}>
        <ToolkitPage toolkit={toolkit!} intake={parseIntake(sp)} generated={gen ? { key, partial: !!gen.meta?.partial, date: gen.last_verified } : null} />
      </DocsShell>
    );
  }

  const intake = parseIntake(sp, guide);
  const view = buildView(guide, intake, typeof sp.path === "string" ? sp.path : null);
  const q = intakeQuery(intake, { path: view.choice.explicit ? view.path.id : undefined });
  return (
    <DocsShell active={`/apps/${guide.slug}`} toc={GUIDE_TOC}>
      <PageHeader
        crumbs={[{ href: "/apps", label: "Guides" }, { label: guide.app.name }]}
        title={
          <span className="flex items-center gap-3">
            <AppIcon src={toolkit?.logo ?? guide.app.logo} name={guide.app.name} size={36} />
            {guide.app.name}
          </span>
        }
        lead={guide.headline}
        meta={
          <>
            <span>Researched guide</span>
            <span aria-hidden>·</span>
            <span>Verified {formatDate(guide.last_verified)}</span>
            <span aria-hidden>·</span>
            <a href="#sources" className="link">
              {view.evidenceList.length} sources
            </a>
            {toolkit && (
              <>
                <span aria-hidden>·</span>
                <span>
                  Composio toolkit <code className="inline">{toolkit.slug}</code>
                </span>
              </>
            )}
          </>
        }
      />
      <div className="mb-6">
        <GuideActions
          markdownUrl={`/api/guides/${guide.slug}/markdown?${q}`}
          appName={guide.app.name}
          recheckUrl={toolkit ? `/generate?q=${encodeURIComponent(guide.app.name)}&toolkit=${toolkit.slug}&fresh=1` : undefined}
        />
      </div>
      <GuideBody view={view} base={`/apps/${guide.slug}`} storageKey={`steps:${guide.slug}:${view.path.id}`} />
    </DocsShell>
  );
}
