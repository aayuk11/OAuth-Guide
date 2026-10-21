"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface LibraryRow {
  slug: string;
  name: string;
  logo: string | null;
  category: string | null;
  kind: "managed" | "byo" | "dcr" | "no_oauth";
  tools: number;
  apiKey: boolean;
  curated: { min: number; max: number } | null;
}

type Filter = "oauth" | "managed" | "byo" | "dcr" | "guides";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "oauth", label: "All OAuth" },
  { id: "guides", label: "Researched guides" },
  { id: "byo", label: "Bring your own" },
  { id: "managed", label: "Managed" },
  { id: "dcr", label: "MCP self-registration" },
];

const KIND: Record<LibraryRow["kind"], string> = {
  managed: "Managed app available",
  byo: "Bring your own app",
  dcr: "No registration needed",
  no_oauth: "No OAuth",
};

const LEVEL_CLS: Record<number, string> = { 1: "bg-l1-bg text-l1", 2: "bg-l2-bg text-l2", 3: "bg-l3-bg text-l3", 4: "bg-l4-bg text-l4" };

export function LibraryList({ rows, initialFilter }: { rows: LibraryRow[]; initialFilter: Filter }) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "oauth" && r.kind === "dcr") return false;
      if (filter === "managed" && r.kind !== "managed") return false;
      if (filter === "byo" && r.kind !== "byo") return false;
      if (filter === "dcr" && r.kind !== "dcr") return false;
      if (filter === "guides" && !r.curated) return false;
      if (term && !r.name.toLowerCase().includes(term) && !r.slug.includes(term) && !(r.category ?? "").includes(term)) return false;
      return true;
    });
  }, [rows, filter, q]);
  return (
    <div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`-mb-px border-b-2 px-2.5 py-1.5 text-sm ${filter === f.id ? "border-accent font-medium text-fg" : "border-transparent text-fg-subtle hover:text-fg"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name or category"
          aria-label="Filter by name or category"
          className="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle md:w-64"
        />
      </div>
      <p className="mt-3 text-xs text-fg-subtle" aria-live="polite">
        {shown.length} toolkit{shown.length === 1 ? "" : "s"}
      </p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-border">
        <table className="table">
          <thead>
            <tr>
              <th>Toolkit</th>
              <th>OAuth app</th>
              <th>Guide</th>
              <th className="hidden sm:table-cell">Category</th>
              <th className="hidden sm:table-cell">Tools</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 400).map((r) => (
              <tr key={r.slug}>
                <td className="strong">
                  <Link href={`/apps/${r.slug}`} className="flex items-center gap-2 no-underline hover:text-accent">
                    {r.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.logo} alt="" width={20} height={20} loading="lazy" className="h-5 w-5 shrink-0 rounded bg-white object-contain" />
                    ) : (
                      <span className="h-5 w-5 shrink-0 rounded bg-bg-muted" />
                    )}
                    {r.name}
                  </Link>
                </td>
                <td>{KIND[r.kind]}</td>
                <td>
                  {r.curated ? (
                    <span className="inline-flex items-center gap-1">
                      <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${LEVEL_CLS[r.curated.min]}`}>L{r.curated.min}</span>
                      {r.curated.max !== r.curated.min && (
                        <>
                          <span className="text-xs text-fg-subtle">to</span>
                          <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${LEVEL_CLS[r.curated.max]}`}>L{r.curated.max}</span>
                        </>
                      )}
                    </span>
                  ) : (
                    <span className="text-fg-subtle">Verdict only</span>
                  )}
                </td>
                <td className="hidden sm:table-cell">{r.category}</td>
                <td className="hidden sm:table-cell">{r.tools}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
