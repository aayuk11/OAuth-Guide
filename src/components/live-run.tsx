"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunEvent, RunRecord } from "@/lib/agent/events";
import { KeyRequired } from "./llm-settings";

type Wire = RunEvent | { type: "attach"; id: string; key: string };
type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";

function host(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

export function LiveRun({
  query,
  toolkit,
  fresh,
  runId,
  autoStart = true,
  stages,
}: {
  query: string;
  toolkit: string | null;
  fresh: boolean;
  runId: string | null;
  /** False when the page was opened from another site: a run spends the visitor's key, so it waits for a click. */
  autoStart?: boolean;
  stages: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [waiting, setWaiting] = useState(!autoStart && !runId && !!query);
  const [candidates, setCandidates] = useState<{ reason: string; options: { slug: string; name: string; kind: string }[] } | null>(null);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(false);
  const finished = useMemo(() => events.some((e) => e.type === "done" || e.type === "error"), [events]);

  useEffect(() => {
    if (finished || error) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [finished, error]);

  const poll = useCallback(async (rid: string) => {
    for (let i = 0; i < 400; i++) {
      try {
        const res = await fetch(`/api/runs/${rid}`, { cache: "no-store" });
        if (res.status === 404) {
          setError("This run was not found. It may have expired, or the server restarted without durable storage.");
          return;
        }
        const rec = (await res.json()) as RunRecord;
        setEvents(rec.events);
        if (rec.status !== "running") return;
      } catch {
        /* transient: keep polling */
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setError("This run is taking far longer than expected and may have stopped. Try again.");
  }, []);

  const go = useCallback(
    async (opts: { q: string; toolkit: string | null; fresh: boolean }) => {
      setError(null);
      setNeedsKey(false);
      setEvents([]);
      setCandidates(null);
      let res: Response;
      try {
        res = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(opts) });
      } catch {
        setError("Could not reach the server.");
        return;
      }
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        if (j.code === "no_key") {
          setNeedsKey(true);
          return;
        }
        setError(j.error ?? `The server returned ${res.status}.`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let currentId: string | null = null;
      let ended = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const msg = JSON.parse(line) as Wire;
            if (msg.type === "attach") {
              window.history.replaceState(null, "", `/generate?run=${msg.id}&q=${encodeURIComponent(opts.q)}`);
              await poll(msg.id);
              return;
            }
            if (msg.type === "redirect") {
              router.push(msg.url);
              return;
            }
            if (msg.type === "candidates") {
              setCandidates({ reason: msg.reason, options: msg.options });
              return;
            }
            if (msg.type === "run") {
              currentId = msg.id;
              window.history.replaceState(null, "", `/generate?run=${msg.id}&q=${encodeURIComponent(opts.q)}`);
            }
            if (msg.type === "done" || msg.type === "error") ended = true;
            setEvents((prev) => [...prev, msg]);
          }
        }
      } catch {
        /* stream dropped: fall back to polling below */
      }
      if (!ended && currentId) await poll(currentId);
    },
    [poll, router],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the run once on mount
    if (runId) void poll(runId);
    else if (query && autoStart) void go({ q: query, toolkit, fresh });
  }, [autoStart, fresh, go, poll, query, runId, toolkit]);

  const guideEvent = events.find((e): e is Extract<RunEvent, { type: "guide" }> => e.type === "guide");
  useEffect(() => {
    if (!guideEvent) return;
    const t = setTimeout(() => router.push(guideEvent.url), guideEvent.partial ? 2500 : 1500);
    return () => clearTimeout(t);
  }, [guideEvent, router]);

  const stageState = useMemo(() => {
    const m = new Map<string, { status: StageStatus; detail?: string }>();
    for (const s of stages) m.set(s.id, { status: "pending" });
    for (const e of events) if (e.type === "step") m.set(e.stage, { status: e.status, detail: e.detail ?? m.get(e.stage)?.detail });
    return m;
  }, [events, stages]);
  const progress = useMemo(() => {
    const p = new Map<string, string>();
    for (const e of events) if (e.type === "progress") p.set(e.stage, e.detail);
    return p;
  }, [events]);
  const feed = events.filter((e) => e.type === "search" || e.type === "read" || e.type === "finding" || e.type === "error");
  const runEvent = events.find((e): e is Extract<RunEvent, { type: "run" }> => e.type === "run");
  const lastT = events.length ? events[events.length - 1].t : 0;
  const elapsed = finished || runId ? lastT : now - startedAt;
  const errorEvent = events.find((e): e is Extract<RunEvent, { type: "error" }> => e.type === "error");
  const title = runEvent?.query ?? query;

  if (needsKey) return <KeyRequired query={query} onReady={() => void go({ q: query, toolkit, fresh })} />;
  if (waiting)
    return (
      <div className="max-w-md">
        <h1 className="text-[1.9rem] font-semibold tracking-[-0.015em] text-fg">Research {query}?</h1>
        <p className="mt-3 text-fg-muted">The agent searches the provider&apos;s docs and writes a guide in a few minutes. It uses your AI key if you have added one.</p>
        <button
          type="button"
          onClick={() => {
            setWaiting(false);
            void go({ q: query, toolkit, fresh });
          }}
          className="mt-6 rounded-md bg-fg px-3 py-2 text-sm font-medium text-bg hover:opacity-90"
        >
          Start research
        </button>
      </div>
    );
  if (!query && !runId) {
    return (
      <div>
        <h1 className="text-[1.9rem] font-semibold text-fg">Nothing to research</h1>
        <Link href="/" className="link mt-3 inline-block">
          Search for an app
        </Link>
      </div>
    );
  }

  const ICON: Record<StageStatus, string> = { pending: "", running: "", done: "✓", skipped: "–", failed: "✕" };
  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-fg-subtle">
        Live research
      </nav>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[1.9rem] font-semibold tracking-[-0.015em] text-fg">Researching {title}</h1>
        <span className="font-mono text-sm text-fg-subtle">{(elapsed / 1000).toFixed(elapsed < 10000 ? 1 : 0)} s</span>
      </div>
      {runEvent && !finished && (
        <p className="mt-2 text-sm text-fg-muted">
          Usually one to three minutes. You can close this tab: the guide will be saved at{" "}
          <Link className="link" href={`/apps/gen/${runEvent.key}`}>
            /apps/gen/{runEvent.key}
          </Link>
          .
        </p>
      )}

      {candidates && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-fg">Which one do you mean?</h2>
          <p className="mt-1 text-sm text-fg-muted">{candidates.reason}</p>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {candidates.options.map((o) => (
              <li key={o.slug}>
                <Link href={`/apps/${o.slug}`} className="flex items-center justify-between px-4 py-2.5 text-sm no-underline hover:bg-bg-subtle">
                  <span className="font-medium text-fg">{o.name}</span>
                  <span className="text-xs text-fg-subtle">{o.kind.replace("_", " ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(error || errorEvent) && (
        <div role="alert" className="mt-6 rounded-lg border-l-[3px] border-bad bg-bad-bg px-4 py-3 text-sm">
          <p className="font-medium text-fg">{error ?? errorEvent?.message}</p>
          {(error || errorEvent?.retryable) && query && (
            <button type="button" onClick={() => void go({ q: query, toolkit, fresh: true })} className="mt-2 rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg">
              Try again
            </button>
          )}
        </div>
      )}

      {!candidates && (
        <div className="mt-8 grid gap-6 lg:grid-cols-[20rem_1fr]">
          <ol className="space-y-3" aria-label="Stages">
            {stages.map((s, i) => {
              const st = stageState.get(s.id)!;
              return (
                <li key={s.id} className="grid grid-cols-[1.5rem_1fr] gap-x-3">
                  <span
                    aria-hidden
                    className={`grid h-6 w-6 place-items-center rounded-full border text-[0.7rem] ${
                      st.status === "done"
                        ? "border-ok bg-ok text-bg"
                        : st.status === "failed"
                          ? "border-bad bg-bad text-bg"
                          : st.status === "running"
                            ? "animate-pulse border-accent text-accent"
                            : "border-border-strong text-fg-subtle"
                    }`}
                  >
                    {ICON[st.status] || i + 1}
                  </span>
                  <div>
                    <div className={`text-sm ${st.status === "pending" || st.status === "skipped" ? "text-fg-subtle" : "font-medium text-fg"}`}>
                      {s.label}
                      <span className="sr-only"> ({st.status})</span>
                    </div>
                    {(st.detail || (st.status === "running" && progress.get(s.id))) && (
                      <p className="text-xs text-fg-subtle">{st.status === "running" ? progress.get(s.id) ?? st.detail : st.detail}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          <section aria-label="Agent activity" className="min-w-0 rounded-lg border border-border bg-code">
            <div className="border-b border-border px-3 py-2 text-xs text-fg-subtle">Agent activity</div>
            <ul className="space-y-1 p-3 font-mono text-xs" aria-live="polite">
              {feed.length === 0 && !finished && <li className="text-fg-subtle">Starting…</li>}
              {feed.map((e, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-12 shrink-0 text-right text-fg-subtle">{(e.t / 1000).toFixed(1)}s</span>
                  {e.type === "search" && (
                    <span className="min-w-0 text-fg">
                      <span className="text-accent">search</span> {e.query}
                    </span>
                  )}
                  {e.type === "read" && (
                    <span className="min-w-0 truncate text-fg">
                      <span className={e.ok ? "text-ok" : "text-bad"}>{e.ok ? "read" : "failed"}</span> {e.title ? `${e.title} · ` : ""}
                      <span className="text-fg-subtle">{host(e.url)}</span>
                      {e.error && <span className="text-fg-subtle"> ({e.error.replace(/_/g, " ")})</span>}
                    </span>
                  )}
                  {e.type === "finding" && (
                    <span className="min-w-0 break-words text-fg">
                      <span className="text-ok">tested</span> {e.text}
                    </span>
                  )}
                  {e.type === "error" && <span className="text-bad">{e.message}</span>}
                </li>
              ))}
            </ul>
            {guideEvent && (
              <div className="border-t border-border px-3 py-3 text-sm">
                <span className="font-medium text-fg">{guideEvent.partial ? "Partial guide saved." : "Guide ready."}</span>{" "}
                <Link href={guideEvent.url} className="link">
                  Open it
                </Link>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
