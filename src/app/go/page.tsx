import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppIcon, DocsShell, PageHeader } from "@/components/docs";
import { resolveToolkit, toolkitKind } from "@/lib/catalog";
import { curatedForToolkit, getCuratedGuide } from "@/lib/guides";
import { guideKeyFor } from "@/lib/agent/pipeline";
import { getGeneratedGuide } from "@/lib/agent/runs";

export const metadata: Metadata = { title: "Find an app", robots: { index: false } };
export const dynamic = "force-dynamic";

const KIND_TEXT = { managed: "Managed app available", byo: "Bring your own app", dcr: "No registration needed", no_oauth: "No OAuth" } as const;

function clean(raw: unknown): string {
  return String(typeof raw === "string" ? raw : "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export default async function Go({ searchParams }: PageProps<"/go">) {
  const sp = await searchParams;
  const q = clean(sp.q);
  if (!q) redirect("/");

  const direct = getCuratedGuide(q.toLowerCase());
  if (direct) redirect(`/apps/${direct.slug}`);

  const r = resolveToolkit(q);
  if (r.kind === "toolkit") {
    const curated = curatedForToolkit(r.toolkit.slug);
    redirect(`/apps/${curated ? curated.slug : r.toolkit.slug}`);
  }

  if (r.kind === "none") {
    const cached = await getGeneratedGuide(guideKeyFor(q, null)).catch(() => null);
    redirect(cached ? `/apps/gen/${cached.slug}` : `/generate?q=${encodeURIComponent(q)}`);
  }

  const options = r.candidates;
  return (
    <DocsShell active="/apps">
      <PageHeader
        crumbs={[{ label: "Search" }, { label: q }]}
        title="Which one do you mean?"
        lead={r.reason}
      />
      {options.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {options.map((t) => {
            const g = curatedForToolkit(t.slug);
            return (
              <li key={t.slug}>
                <Link href={`/apps/${g?.slug ?? t.slug}`} className="flex items-center justify-between gap-3 px-4 py-2.5 no-underline hover:bg-bg-subtle">
                  <span className="flex items-center gap-2 text-sm font-medium text-fg">
                    <AppIcon src={t.logo} name={t.name} size={22} />
                    {t.name}
                  </span>
                  <span className="text-xs text-fg-subtle">{g ? "Researched guide" : KIND_TEXT[toolkitKind(t)]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Link href={`/generate?q=${encodeURIComponent(q)}`} className="mt-4 inline-block rounded-md border border-border px-3 py-1.5 text-sm text-fg no-underline hover:border-border-strong">
        None of these: research “{q}” as typed
      </Link>
    </DocsShell>
  );
}
