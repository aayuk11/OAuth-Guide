import Link from "next/link";
import type { ReactNode } from "react";
import { curatedGuides } from "@/lib/guides";
import type { Evidence, EvidenceLabel, Owner } from "@/lib/guide/schema";
import { LEVEL_NAMES } from "@/lib/guide/scoring";
import { CopyButton } from "./client";

/* ---------- Shell: left nav, content, on-this-page ---------- */

export interface TocItem {
  id: string;
  label: string;
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-md px-2.5 py-1.5 text-sm no-underline ${active ? "bg-accent-subtle font-medium text-accent" : "text-fg-muted hover:bg-bg-muted hover:text-fg"}`}
    >
      {children}
    </Link>
  );
}

function SideNav({ active }: { active?: string }) {
  const guides = curatedGuides();
  const group = (title: string, links: { href: string; label: string }[]) => (
    <div className="mb-6">
      <div className="mb-1.5 px-2.5 text-xs font-semibold text-fg">{title}</div>
      {links.map((l) => (
        <NavLink key={l.href} href={l.href} active={active === l.href}>
          {l.label}
        </NavLink>
      ))}
    </div>
  );
  return (
    <>
      {group("Get started", [
        { href: "/", label: "Overview" },
        { href: "/concepts", label: "Concepts and terms" },
      ])}
      {group("Guides", [...guides.map((g) => ({ href: `/apps/${g.slug}`, label: g.app.name })), { href: "/apps", label: "All toolkits" }])}
      {group("How it works", [
        { href: "/method", label: "Method" },
        { href: "/evidence", label: "Evidence" },
        { href: "/reference", label: "API reference" },
      ])}
    </>
  );
}

export function DocsShell({ children, toc, active, wide = false }: { children: ReactNode; toc?: TocItem[]; active?: string; wide?: boolean }) {
  return (
    <div className="mx-auto flex max-w-[90rem] gap-10 px-4 lg:px-6">
      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r border-border py-8 pr-4 lg:block" aria-label="Documentation">
        <SideNav active={active} />
      </aside>
      <div className={`min-w-0 flex-1 py-8 lg:py-10 ${wide ? "" : "max-w-[48rem]"}`}>
        <details className="no-print mb-6 rounded-lg border border-border lg:hidden">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-fg-muted">Menu</summary>
          <div className="border-t border-border p-3">
            <SideNav active={active} />
          </div>
        </details>
        {children}
      </div>
      {toc && toc.length > 0 && (
        <nav aria-label="On this page" className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-52 shrink-0 overflow-y-auto py-10 xl:block">
          <div className="mb-2 text-xs font-semibold text-fg">On this page</div>
          {toc.map((t) => (
            <a key={t.id} href={`#${t.id}`} className="block py-1 text-sm text-fg-subtle no-underline hover:text-fg">
              {t.label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

export function PageHeader({ crumbs, title, lead, actions, meta }: { crumbs?: { href?: string; label: string }[]; title: ReactNode; lead?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="mb-8">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-fg-subtle">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>/</span>}
              {c.href ? (
                <Link href={c.href} className="no-underline hover:text-fg">
                  {c.label}
                </Link>
              ) : (
                <span>{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-[1.9rem] font-semibold leading-tight tracking-[-0.015em] text-fg">{title}</h1>
        {actions}
      </div>
      {lead && <p className="mt-3 max-w-3xl text-[1.05rem] leading-relaxed text-fg-muted">{lead}</p>}
      {meta && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-subtle">{meta}</div>}
    </header>
  );
}

export function H2({ id, children, aside }: { id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 mt-12 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
      <h2 id={id} className="scroll-mt-20 text-[1.3rem] font-semibold tracking-[-0.01em] text-fg">
        <a href={`#${id}`} className="no-underline">
          {children}
        </a>
      </h2>
      {aside && <div className="text-sm text-fg-subtle">{aside}</div>}
    </div>
  );
}

/* ---------- Badges ---------- */

const LEVEL_CLS: Record<number, string> = { 1: "bg-l1-bg text-l1", 2: "bg-l2-bg text-l2", 3: "bg-l3-bg text-l3", 4: "bg-l4-bg text-l4" };

export function LevelBadge({ level, unconfirmed = false, name = true }: { level: 1 | 2 | 3 | 4; unconfirmed?: boolean; name?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ${LEVEL_CLS[level]}`} title={unconfirmed ? "At least this level; an open question could raise it" : undefined}>
      L{level}
      {unconfirmed ? "+" : ""}
      {name && <span className="font-normal">· {LEVEL_NAMES[level]}</span>}
    </span>
  );
}

export function LevelRange({ min, max }: { min: number; max: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <LevelBadge level={min as 1} name={false} />
      {max !== min && (
        <>
          <span className="text-xs text-fg-subtle">to</span>
          <LevelBadge level={max as 1} name={false} />
        </>
      )}
    </span>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "bad";
const TONE: Record<Tone, string> = {
  neutral: "bg-bg-muted text-fg-muted",
  accent: "bg-accent-subtle text-accent",
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}

export const OWNER_TEXT: Record<Owner, string> = { agent_done: "Done by agent", agent_can_do: "Agent can do", agent_drafts: "Agent drafts, you submit", you: "You" };
const OWNER_TONE: Record<Owner, Tone> = { agent_done: "ok", agent_can_do: "accent", agent_drafts: "accent", you: "neutral" };

export function OwnerBadge({ owner }: { owner: Owner }) {
  return <Badge tone={OWNER_TONE[owner]}>{OWNER_TEXT[owner]}</Badge>;
}

/* ---------- Callout ---------- */

const CALLOUT: Record<Tone, string> = {
  neutral: "border-border-strong bg-bg-subtle",
  accent: "border-accent bg-accent-subtle",
  ok: "border-ok bg-ok-bg",
  warn: "border-warn bg-warn-bg",
  bad: "border-bad bg-bad-bg",
};

export function Callout({ tone = "accent", title, children }: { tone?: Tone; title?: ReactNode; children: ReactNode }) {
  return (
    <div className={`my-4 rounded-lg border-l-[3px] px-4 py-3 text-sm ${CALLOUT[tone]}`}>
      {title && <div className="mb-0.5 font-semibold text-fg">{title}</div>}
      <div className="text-fg-muted [&_a]:text-accent">{children}</div>
    </div>
  );
}

/* ---------- Code ---------- */

export function CodeBlock({ code, label, className = "" }: { code: string; label?: string; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-lg border border-border bg-code ${className}`}>
      {label !== undefined && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          <span className="text-xs text-fg-subtle">{label}</span>
          <CopyButton text={code} />
        </div>
      )}
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto px-3 py-2.5 font-mono text-[0.8rem] leading-relaxed text-fg">
          <code>{code}</code>
        </pre>
        {label === undefined && <CopyButton text={code} className="mr-2 mt-2" />}
      </div>
    </div>
  );
}

export function InlineCode({ children }: { children: ReactNode }) {
  return <code className="inline">{children}</code>;
}

/** Render `backticks` in guide text as inline code. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
          <code key={i} className="inline">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/* ---------- Citations (footnotes) ---------- */

export type EvidenceIndex = Record<string, { n: number; e: Evidence }>;

const RANK: Record<EvidenceLabel, number> = { tested: 3, official: 2, reported: 1, unverified: 0 };
const LABEL_WORD: Record<EvidenceLabel, string> = { tested: "Tested", official: "Official", reported: "Reported", unverified: "Unverified" };

/**
 * Footnote-style citation. Official is the norm and shows only the number;
 * weaker (Reported, Unverified) or stronger (Tested) evidence is named next to it.
 */
export function Cite({ ids, index }: { ids: string[]; index: EvidenceIndex }) {
  const entries = [...new Set(ids)].map((id) => index[id]).filter((x): x is { n: number; e: Evidence } => !!x);
  if (!entries.length) return <span className="ml-1 text-[0.7rem] font-medium text-bad">unverified</span>;
  const best = entries.reduce<EvidenceLabel>((b, x) => (RANK[x.e.label] > RANK[b] ? x.e.label : b), "unverified");
  const tag = best === "official" ? null : best;
  return (
    <span className="cite">
      <a href={`#src-${entries[0].e.id}`} aria-label={`${LABEL_WORD[best]} source ${entries.map((x) => x.n).join(", ")}`}>
        [{entries.map((x) => x.n).join(",")}]
      </a>
      {tag && <span className={`ml-1 text-[0.7rem] font-medium ${tag === "tested" ? "text-ok" : tag === "reported" ? "text-warn" : "text-bad"}`}>{tag}</span>}
      <span className="cite-pop rounded-lg border border-border bg-bg p-3 text-xs leading-relaxed text-fg-muted shadow-lg" role="tooltip">
        {entries.slice(0, 3).map(({ n, e }) => (
          <span key={e.id} className="mb-2 block last:mb-0">
            <span className="block font-medium text-fg">
              [{n}] {e.title}
            </span>
            <span className="block text-fg-subtle">
              {LABEL_WORD[e.label]} · {e.publisher ?? ""} · read {e.retrieved}
            </span>
            {e.excerpt && <span className="mt-1 block">“{e.excerpt.length > 200 ? `${e.excerpt.slice(0, 200)}…` : e.excerpt}”</span>}
          </span>
        ))}
      </span>
    </span>
  );
}

/* ---------- Disclosure ---------- */

export function Disclosure({ title, meta, children, open = false, id }: { title: ReactNode; meta?: ReactNode; children: ReactNode; open?: boolean; id?: string }) {
  return (
    <details className="disclosure" open={open} id={id}>
      <summary>
        <span className="min-w-0 flex-1">{title}</span>
        {meta && <span className="shrink-0 text-xs font-normal text-fg-subtle">{meta}</span>}
      </summary>
      <div className="disclosure-body text-sm">{children}</div>
    </details>
  );
}

/* ---------- Diagrams ---------- */

export interface FlowStep {
  title: string;
  detail?: string;
  tag?: string;
  tone?: Tone;
}

/** Horizontal flow with arrows; stacks vertically on small screens. */
export function Flow({ steps, caption }: { steps: FlowStep[]; caption?: string }) {
  return (
    <figure className="my-5">
      <ol className="flex flex-col items-stretch gap-2 md:flex-row md:items-stretch md:gap-0">
        {steps.map((s, i) => (
          <li key={i} className="flex flex-col items-stretch [overflow-wrap:normal] md:flex-1 md:flex-row md:items-center">
            <div className="h-full flex-1 rounded-lg border border-border bg-bg-subtle px-3 py-2.5">
              {s.tag && (
                <div className="mb-1">
                  <Badge tone={s.tone ?? "neutral"}>{s.tag}</Badge>
                </div>
              )}
              <div className="text-sm font-medium leading-snug text-fg">{s.title}</div>
              {s.detail && <p className="mt-1 text-xs leading-snug text-fg-subtle [overflow-wrap:normal]">{s.detail}</p>}
            </div>
            {i < steps.length - 1 && (
              <span aria-hidden className="grid place-items-center py-0.5 text-fg-subtle md:px-1.5 md:py-0">
                <span className="md:hidden">↓</span>
                <span className="hidden md:inline">→</span>
              </span>
            )}
          </li>
        ))}
      </ol>
      {caption && <figcaption className="mt-2 text-xs text-fg-subtle">{caption}</figcaption>}
    </figure>
  );
}

/** Yes/no decision ladder: each question either ends in an outcome or continues down. */
export function DecisionLadder({ rows, last }: { rows: { q: string; exit: string; exitOn: "Yes" | "No"; tone?: Tone }[]; last: { label: string; tone?: Tone } }) {
  return (
    <figure className="my-5 space-y-0">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
            <div className="rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-fg">{r.q}</div>
            <div className="text-center text-xs text-fg-subtle">
              {r.exitOn} <span aria-hidden>→</span>
            </div>
            <div className={`rounded-lg px-3 py-2.5 text-sm font-medium ${TONE[r.tone ?? "neutral"]}`}>{r.exit}</div>
          </div>
          <div className="py-1 pl-6 text-xs text-fg-subtle">
            <span aria-hidden>↓</span> {r.exitOn === "Yes" ? "No" : "Yes"}
          </div>
        </div>
      ))}
      <div className={`rounded-lg px-3 py-2.5 text-sm font-medium sm:max-w-[calc(50%-1.5rem)] ${TONE[last.tone ?? "neutral"]}`}>{last.label}</div>
    </figure>
  );
}

/** Small key-value summary grid. */
export function Stats({ items }: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
      {items.map((it, i) => (
        <div key={i} className="bg-bg px-4 py-3">
          <dt className="text-xs text-fg-subtle">{it.label}</dt>
          <dd className="mt-1 text-[0.95rem] font-semibold text-fg">{it.value}</dd>
          {it.note && <dd className="mt-0.5 text-xs text-fg-subtle">{it.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function AppIcon({ src, name, size = 32 }: { src?: string | null; name: string; size?: number }) {
  if (src)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} loading="lazy" className="shrink-0 rounded-md border border-border bg-white object-contain p-1" style={{ width: size, height: size }} />;
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-md border border-border bg-bg-muted text-sm font-medium text-fg-muted" style={{ width: size, height: size }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
