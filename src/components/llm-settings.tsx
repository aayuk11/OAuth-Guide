"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PROVIDER_IDS, PROVIDERS, type KeyStatus, type ProviderId } from "@/lib/llm/catalog";

/** Fired on window whenever the key changes, so the header button and the live run stay in sync. */
const KEY_EVENT = "llm-key-change";

async function fetchStatus(): Promise<KeyStatus | null> {
  try {
    const res = await fetch("/api/settings/llm", { cache: "no-store" });
    return res.ok ? ((await res.json()) as KeyStatus) : null;
  } catch {
    return null;
  }
}

function announce(s: KeyStatus) {
  window.dispatchEvent(new CustomEvent<KeyStatus>(KEY_EVENT, { detail: s }));
}

function useKeyStatus() {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchStatus().then((s) => alive && s && setStatus(s));
    const on = (e: Event) => setStatus((e as CustomEvent<KeyStatus>).detail);
    window.addEventListener(KEY_EVENT, on);
    return () => {
      alive = false;
      window.removeEventListener(KEY_EVENT, on);
    };
  }, []);
  return status;
}

function describe(s: KeyStatus | null): string {
  if (!s) return "Checking…";
  if (s.browser) return `Your ${s.browser.vendor} key ${s.browser.hint} · ${s.browser.model}`;
  if (s.server) return `This site's ${s.server.vendor} key · ${s.server.model}`;
  return "No key set";
}

/** Add, test or remove the key used for live research. */
export function KeyForm({ status, onSaved }: { status: KeyStatus | null; onSaved?: (s: KeyStatus) => void }) {
  const id = useId();
  const [provider, setProvider] = useState<ProviderId>(status?.browser?.provider ?? "google");
  const [model, setModel] = useState(status?.browser?.model ?? PROVIDERS[status?.browser?.provider ?? "google"].defaultModel);
  const [apiKey, setApiKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = PROVIDERS[provider];

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/llm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, apiKey, model, remember }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(j.error ?? `The server returned ${res.status}.`);
      else {
        setApiKey("");
        announce(j as KeyStatus);
        onSaved?.(j as KeyStatus);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    const res = await fetch("/api/settings/llm", { method: "DELETE" }).catch(() => null);
    if (res?.ok) announce((await res.json()) as KeyStatus);
    setBusy(false);
  };

  return (
    <form onSubmit={save} className="space-y-4 text-sm">
      {status?.browser && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2">
          <span className="text-fg">
            In use: <span className="font-medium">{describe(status)}</span>
          </span>
          <button type="button" onClick={() => void remove()} disabled={busy} className="rounded-md border border-border bg-bg px-2.5 py-1 text-fg hover:border-border-strong disabled:opacity-50">
            Remove
          </button>
        </div>
      )}
      {!status?.browser && status?.server && <p className="text-fg-muted">This site already has a {status.server.vendor} key. Add your own to run on your account instead.</p>}

      <fieldset>
        <legend className="mb-1.5 font-medium text-fg">Provider</legend>
        <div className="grid grid-cols-3 gap-1 rounded-md border border-border p-1">
          {PROVIDER_IDS.map((p) => (
            <label key={p} className={`cursor-pointer rounded px-2 py-1.5 text-center has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${provider === p ? "bg-fg text-bg" : "text-fg-muted hover:bg-bg-muted"}`}>
              <input
                type="radio"
                name={`${id}-provider`}
                value={p}
                checked={provider === p}
                onChange={() => {
                  setProvider(p);
                  setModel(PROVIDERS[p].defaultModel);
                  setError(null);
                }}
                className="sr-only"
              />
              <span className="font-medium">{PROVIDERS[p].label}</span>
              <span className="block text-[0.7rem] opacity-75">{PROVIDERS[p].vendor}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor={`${id}-key`} className="font-medium text-fg">
            {info.vendor} API key
          </label>
          <a href={info.keyUrl} target="_blank" rel="noreferrer" className="link text-xs">
            Get a key
          </a>
        </div>
        <input
          id={`${id}-key`}
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={provider === "anthropic" ? "sk-ant-…" : provider === "openai" ? "sk-…" : "AIza…"}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor={`${id}-model`} className="mb-1.5 block font-medium text-fg">
          Model
        </label>
        <input
          id={`${id}-model`}
          list={`${id}-models`}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          spellCheck={false}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-fg focus:border-accent focus:outline-none"
        />
        <datalist id={`${id}-models`}>
          {info.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <p className="mt-1 text-xs text-fg-subtle">
          Default: {info.defaultModel}.
          {provider === "google" && " Free-tier Gemini keys have limited or no Google Search, so research finds less. A key with billing enabled works best."}
        </p>
      </div>

      <label className="flex items-center gap-2 text-fg-muted">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
        Remember on this browser for 30 days
      </label>

      {error && (
        <p role="alert" className="rounded-md border-l-[3px] border-bad bg-bad-bg px-3 py-2 text-fg">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy || !apiKey} className="w-full rounded-md bg-fg px-3 py-2 font-medium text-bg hover:opacity-90 disabled:opacity-50">
        {busy ? "Testing the key…" : "Save and test"}
      </button>

      <p className="text-xs leading-relaxed text-fg-subtle">
        The key is tested with a read-only call, then kept encrypted in an HttpOnly cookie that page scripts cannot read and only this site&apos;s API receives. It is never
        written to the server&apos;s storage, logged, or shown again. Runs are billed to your {info.vendor} account.
      </p>
    </form>
  );
}

/** Header button: shows whether a key is set and opens the key dialog. */
export function KeyButton() {
  const status = useKeyStatus();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const dot = !status ? "bg-border-strong" : status.browser ? "bg-ok" : status.server ? "bg-accent" : "border border-fg-subtle bg-transparent";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          ref.current?.showModal();
        }}
        title={describe(status)}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-fg-muted hover:bg-bg-muted hover:text-fg"
      >
        <span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />
        <span>AI key</span>
        <span className="sr-only">: {describe(status)}</span>
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        aria-labelledby="key-dialog-title"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-bg p-0 text-fg shadow-xl backdrop:bg-black/40"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="key-dialog-title" className="text-base font-semibold">
              AI key for live research
            </h2>
            <p className="mt-0.5 text-sm text-fg-muted">The agent researches apps that have no guide yet. Bring a Claude, Gemini or GPT key.</p>
          </div>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-bg-muted hover:text-fg">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{open && <KeyForm status={status} onSaved={() => ref.current?.close()} />}</div>
      </dialog>
    </>
  );
}

/** Shown in place of a run when no key is available; retries once a key is saved. */
export function KeyRequired({ query, onReady }: { query: string; onReady: () => void }) {
  const status = useKeyStatus();
  // Retry once a key is saved, from the form below or from the header's AI key dialog.
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  });
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<KeyStatus>).detail.active) ready.current();
    };
    window.addEventListener(KEY_EVENT, on);
    return () => window.removeEventListener(KEY_EVENT, on);
  }, []);
  return (
    <div className="max-w-md">
      <h1 className="text-[1.9rem] font-semibold tracking-[-0.015em] text-fg">Add an AI key to research {query}</h1>
      <p className="mt-3 text-fg-muted">
        There is no guide for this app yet. The agent can write one in a few minutes using web search, with a Claude, Gemini or GPT key. Guides in the library work without a
        key.
      </p>
      <div className="mt-6 rounded-lg border border-border p-5">
        <KeyForm status={status} />
      </div>
    </div>
  );
}
