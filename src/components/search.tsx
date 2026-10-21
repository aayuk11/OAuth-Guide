"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

interface Item {
  s: string;
  n: string;
  k: "managed" | "byo" | "dcr" | "no_oauth";
  c: string | null;
  t: number;
  g?: 1;
}

const KIND: Record<Item["k"], string> = {
  managed: "Managed app",
  byo: "Bring your own",
  dcr: "Self-registers",
  no_oauth: "No OAuth",
};

let cache: Promise<Item[]> | null = null;
function loadIndex() {
  cache ??= fetch("/api/search-index")
    .then((r) => r.json() as Promise<Item[]>)
    .catch(() => {
      cache = null;
      return [];
    });
  return cache;
}

function score(it: Item, q: string): number {
  const n = it.n.toLowerCase();
  const s = it.s.toLowerCase();
  if (n === q || s === q) return 100;
  if (n.startsWith(q) || s.startsWith(q)) return 60 - n.length / 10;
  if (n.includes(q) || s.includes(q)) return 30 - n.length / 10;
  return 0;
}

function useSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const results = useMemo(() => {
    const term = q.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
    if (!term) return [];
    return items
      .map((it) => ({ it, sc: score(it, term) + (it.g ? 8 : 0) + (it.k !== "no_oauth" ? 2 : 0) + Math.min(3, Math.log10(1 + it.t)) }))
      .filter((x) => x.sc > 3)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 7)
      .map((x) => x.it);
  }, [items, q]);
  const go = (target: string) => {
    setOpen(false);
    router.push(target);
  };
  const submit = () => {
    const pick = active >= 0 ? results[active] : null;
    if (pick) return go(`/apps/${pick.s}`);
    const term = q.trim();
    if (term) go(`/go?q=${encodeURIComponent(term.slice(0, 120))}`);
  };
  const load = async () => {
    setOpen(true);
    if (!items.length) setItems(await loadIndex());
  };
  return { q, setQ, results, open, setOpen, active, setActive, go, submit, load };
}

function Results({ s, id }: { s: ReturnType<typeof useSearch>; id: string }) {
  if (!s.open || !s.q.trim()) return null;
  return (
    <ul id={id} role="listbox" className="absolute left-0 right-0 z-40 mt-1.5 overflow-hidden rounded-lg border border-border bg-bg py-1 text-sm shadow-lg">
      {s.results.map((r, i) => (
        <li key={r.s} id={`${id}-${i}`} role="option" aria-selected={i === s.active}>
          <button
            type="button"
            onMouseEnter={() => s.setActive(i)}
            onClick={() => s.go(`/apps/${r.s}`)}
            className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${i === s.active ? "bg-bg-muted" : ""}`}
          >
            <span className="min-w-0 truncate">
              <span className="font-medium text-fg">{r.n}</span>
              {r.g && <span className="ml-2 rounded bg-accent-subtle px-1.5 py-px text-[0.7rem] font-medium text-accent">Guide</span>}
            </span>
            <span className="shrink-0 text-xs text-fg-subtle">{KIND[r.k]}</span>
          </button>
        </li>
      ))}
      <li role="option" aria-selected={s.active === -1}>
        <button type="button" onClick={() => s.go(`/go?q=${encodeURIComponent(s.q.trim().slice(0, 120))}`)} className="w-full border-t border-border px-3 py-2 text-left text-fg-muted hover:bg-bg-muted">
          {s.results.length ? `Search for “${s.q.trim().slice(0, 50)}”` : `“${s.q.trim().slice(0, 50)}” is not in Composio's catalogue. Research it →`}
        </button>
      </li>
    </ul>
  );
}

function Field({ s, big, id, autoFocus }: { s: ReturnType<typeof useSearch>; big: boolean; id: string; autoFocus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { setOpen } = s;
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [setOpen]);
  return (
    <div ref={ref} className="relative w-full">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          s.submit();
        }}
        className={`flex items-center rounded-lg border border-border bg-bg-subtle focus-within:border-accent focus-within:bg-bg ${big ? "h-12 px-4" : "h-9 px-3"}`}
      >
        <svg viewBox="0 0 20 20" className={`${big ? "h-5 w-5" : "h-4 w-4"} shrink-0 text-fg-subtle`} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
        </svg>
        <label htmlFor={id} className="sr-only">
          App name or website
        </label>
        <input
          id={id}
          autoFocus={autoFocus}
          value={s.q}
          maxLength={120}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={s.open && s.results.length > 0}
          aria-controls={`${id}-list`}
          placeholder={big ? "Search an app or paste its website, e.g. Gmail, Shopify, getjobber.com" : "Search apps…"}
          onFocus={s.load}
          onChange={(e) => {
            s.setQ(e.target.value);
            s.setActive(-1);
            s.setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              s.setActive(Math.min(s.results.length - 1, s.active + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              s.setActive(Math.max(-1, s.active - 1));
            } else if (e.key === "Escape") s.setOpen(false);
          }}
          className={`min-w-0 flex-1 bg-transparent pl-2.5 text-fg outline-none placeholder:text-fg-subtle ${big ? "text-base" : "text-sm"}`}
        />
        {big && (
          <button type="submit" className="ml-2 shrink-0 rounded-md bg-fg px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90">
            Look up
          </button>
        )}
      </form>
      <Results s={s} id={`${id}-list`} />
    </div>
  );
}

export function HeaderSearch() {
  const s = useSearch();
  return <Field s={s} big={false} id="header-search" />;
}

export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const s = useSearch();
  return <Field s={s} big id="page-search" autoFocus={autoFocus} />;
}
