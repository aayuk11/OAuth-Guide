"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        setState((await copyText(text)) ? "ok" : "fail");
        setTimeout(() => setState("idle"), 1500);
      }}
      className={`no-print shrink-0 rounded-md border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted hover:border-border-strong hover:text-fg ${className}`}
      aria-live="polite"
    >
      {state === "ok" ? "Copied" : state === "fail" ? "Failed" : label}
    </button>
  );
}

const AGENT_PROMPT = (app: string, md: string) => `I am connecting ${app} to my AI agent through Composio and need my own OAuth app.
Use the readiness guide below as the source of truth.

1. List the steps I must do in the provider's console, in order, with the exact values to paste.
2. Write the code that uses my Composio auth config (ac_...) in a session for this toolkit.
3. Tell me which approval gates apply to my path, how long they take, and what I must submit.
4. Flag anything marked Reported or Unverified that I should confirm before relying on it.
Do not invent values that are not in the guide.

---

${md}`;

export function GuideActions({ markdownUrl, appName, recheckUrl }: { markdownUrl: string; appName: string; recheckUrl?: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 1800);
  };
  const copyFrom = async (wrap: (md: string) => string, done: string) => {
    try {
      const md = await (await fetch(markdownUrl)).text();
      flash((await copyText(wrap(md))) ? done : "Copy failed");
    } catch {
      flash("Could not load the guide");
    }
  };
  const btn = "rounded-md border border-border bg-bg px-2.5 py-1 text-sm text-fg-muted hover:border-border-strong hover:text-fg";
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <button type="button" className={btn} onClick={() => copyFrom((md) => md, "Markdown copied")} title="The whole guide for your current setup, with sources and legend">
        Copy as Markdown
      </button>
      <button type="button" className={btn} onClick={() => copyFrom((md) => AGENT_PROMPT(appName, md), "Prompt copied")} title="The guide wrapped in instructions for Claude, Cursor or another coding agent">
        Copy prompt for a coding agent
      </button>
      {recheckUrl && (
        <a className={`${btn} no-underline`} href={recheckUrl} title="Run the research agent now and compare">
          Re-check
        </a>
      )}
      <span role="status" aria-live="polite" className="text-xs text-ok">
        {msg}
      </span>
    </div>
  );
}

/* ---------- Setup selector ---------- */

export interface PathOption {
  id: string;
  label: string;
  level: number;
  matches: boolean;
}

export function SetupBar({ base, audience, access, brand, pathId, paths }: { base: string; audience: string; access: string; brand: boolean; pathId: string; paths: PathOption[] }) {
  const router = useRouter();
  const go = (form: HTMLFormElement, changed: string) => {
    const fd = new FormData(form);
    if (changed !== "path") fd.delete("path");
    const qs = new URLSearchParams(fd as unknown as Record<string, string>).toString();
    router.replace(`${base}?${qs}`, { scroll: false });
  };
  const sel = "w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg";
  const lab = "mb-1 block text-xs text-fg-subtle";
  return (
    <form method="get" action={base} className={`no-print grid gap-3 rounded-lg border border-border bg-bg-subtle p-3 sm:grid-cols-2 ${paths.length ? "lg:grid-cols-4" : "lg:grid-cols-3"}`} onChange={(e) => go(e.currentTarget, (e.target as unknown as HTMLSelectElement).name)}>
      <label>
        <span className={lab}>Who connects</span>
        <select name="audience" defaultValue={audience} className={sel}>
          <option value="external">External customers</option>
          <option value="own_org">Only my organisation</option>
        </select>
      </label>
      <label>
        <span className={lab}>Access needed</span>
        <select name="access" defaultValue={access} className={sel}>
          <option value="read">Read</option>
          <option value="write">Write or send</option>
          <option value="admin">Admin or full</option>
        </select>
      </label>
      <label>
        <span className={lab}>Consent screen shows</span>
        <select name="brand" defaultValue={brand ? "yes" : "no"} className={sel}>
          <option value="yes">Your brand</option>
          <option value="no">Composio is fine</option>
        </select>
      </label>
      {paths.length > 0 && (
        <label>
          <span className={lab}>Path</span>
          <select name="path" defaultValue={pathId} className={sel}>
            {paths.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} (L{p.level}){p.matches ? "" : " · other setup"}
              </option>
            ))}
          </select>
        </label>
      )}
      <noscript>
        <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm">
          Apply
        </button>
      </noscript>
    </form>
  );
}

/* ---------- Steps ---------- */

export interface StepItem {
  id: string;
  title: string;
  owner: string;
  meta: ReactNode;
  body: ReactNode;
}

/** Numbered steps. Clicking a number marks it done; progress is kept in this browser only. */
export function StepList({ storageKey, items, heading }: { storageKey: string; items: StepItem[]; heading: string }) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore ticks saved in this browser
      if (raw) setDone(JSON.parse(raw));
    } catch {
      /* storage unavailable */
    }
  }, [storageKey]);
  const toggle = useCallback(
    (id: string) =>
      setDone((d) => {
        const next = { ...d, [id]: !d[id] };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      }),
    [storageKey],
  );
  const count = items.filter((i) => done[i.id]).length;
  const progress = [`${heading}: ${count}/${items.length} steps done`, "", ...items.map((i, n) => `- [${done[i.id] ? "x" : " "}] ${n + 1}. ${i.title} (${i.owner})`)].join("\n");
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2 text-xs text-fg-subtle">
        <span aria-live="polite">
          {count} of {items.length} done · click a number to mark it
        </span>
        <CopyButton text={progress} label="Copy progress" />
      </div>
      <ol className="steps">
        {items.map((it, n) => (
          <li key={it.id}>
            <button
              type="button"
              aria-pressed={!!done[it.id]}
              aria-label={`Mark step ${n + 1} ${done[it.id] ? "not done" : "done"}`}
              onClick={() => toggle(it.id)}
              className={`absolute left-0 top-0 grid h-7 w-7 place-items-center rounded-full border text-xs font-medium ${done[it.id] ? "border-ok bg-ok text-bg" : "border-border-strong bg-bg text-fg-muted hover:border-fg-subtle"}`}
            >
              {done[it.id] ? "✓" : n + 1}
            </button>
            <div className={done[it.id] ? "opacity-60" : ""}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 className="text-[0.95rem] font-semibold text-fg">{it.title}</h3>
                {it.meta}
              </div>
              <div className="mt-1.5">{it.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- Tabs (code samples) ---------- */

export function Tabs({ tabs, initial = 0 }: { tabs: { label: string; content: ReactNode }[]; initial?: number }) {
  const [i, setI] = useState(Math.min(initial, tabs.length - 1));
  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-x-1 border-b border-border">
        {tabs.map((t, n) => (
          <button
            key={t.label}
            role="tab"
            type="button"
            aria-selected={i === n}
            onClick={() => setI(n)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${i === n ? "border-accent font-medium text-fg" : "border-transparent text-fg-subtle hover:text-fg"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="pt-2">
        {tabs[i].content}
      </div>
    </div>
  );
}

/* ---------- Agent checks ---------- */

type CheckKind = "url_live" | "redirect_uri" | "oauth_discovery";

export function AgentCheck({ kind, placeholder, initial = "" }: { kind: CheckKind; placeholder: string; initial?: string }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; summary: string } | null>(null);
  const label = { url_live: "Check it loads", redirect_uri: "Check format", oauth_discovery: "Probe" }[kind];
  return (
    <form
      className="no-print mt-2 flex flex-col gap-2 sm:flex-row sm:items-center"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setResult(null);
        try {
          const res = await fetch("/api/checks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, value }) });
          const json = await res.json();
          setResult(res.ok ? json : { ok: false, summary: json.error ?? "Check failed" });
        } catch {
          setResult({ ok: false, summary: "Network error" });
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={300}
        className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg placeholder:text-fg-subtle"
      />
      <button type="submit" disabled={busy || !value.trim()} className="rounded-md border border-border bg-bg-subtle px-3 py-1.5 text-xs font-medium text-fg hover:border-border-strong disabled:opacity-50">
        {busy ? "Checking…" : label}
      </button>
      {result && (
        <span role="status" className={`text-xs ${result.ok ? "text-ok" : "text-bad"}`}>
          {result.ok ? "✓ " : "✗ "}
          {result.summary}
        </span>
      )}
    </form>
  );
}
