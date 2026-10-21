import { cookies } from "next/headers";
import { after } from "next/server";
import { getToolkit, resolveToolkit, toolkitKind } from "@/lib/catalog";
import { agentConfig } from "@/lib/agent/config";
import type { RunEvent } from "@/lib/agent/events";
import { guideKeyFor, runPipeline } from "@/lib/agent/pipeline";
import { checkRateLimit, getGeneratedGuide, inflightRun, startRun, subscribe } from "@/lib/agent/runs";
import { resolveCredentials, sameOrigin } from "@/lib/llm/credentials";
import { errorText, redactKeys } from "@/lib/llm/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** One NDJSON message per line. Transport-only messages ("attach") are not part of a run's events. */
type Wire = RunEvent | { type: "attach"; id: string; key: string };

function ndjson(lines: Wire[]): Response {
  return new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || req.headers.get("x-real-ip") || "local").trim().slice(0, 64);
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  let body: { q?: unknown; toolkit?: unknown; fresh?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON: { q: string }" }, { status: 400 });
  }
  const q = String(body.q ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (q.length < 2) return Response.json({ error: "Enter an app name or website." }, { status: 400 });

  let toolkit = typeof body.toolkit === "string" ? getToolkit(body.toolkit) : null;
  if (!toolkit) {
    const r = resolveToolkit(q);
    if (r.kind === "candidates")
      return ndjson([{ t: 0, type: "candidates", reason: r.reason, options: r.candidates.map((c) => ({ slug: c.slug, name: c.name, kind: toolkitKind(c) })) }]);
    if (r.kind === "toolkit") toolkit = r.toolkit;
  }
  const key = guideKeyFor(q, toolkit);

  if (body.fresh !== true) {
    const cached = await getGeneratedGuide(key).catch(() => null);
    if (cached) return ndjson([{ t: 0, type: "redirect", url: `/apps/gen/${key}`, reason: `A guide for ${cached.app.name} was generated on ${cached.last_verified}.` }]);
  }
  const running = await inflightRun(key).catch(() => null);
  if (running) return ndjson([{ type: "attach", id: running, key }]);

  // Cached guides and runs already in progress need no key; a new run does.
  // The key is decrypted here and passed to the pipeline in memory; it is never stored or logged.
  const mock = agentConfig().mock;
  const resolved = mock ? null : resolveCredentials(await cookies());
  if (!mock && !resolved) return Response.json({ error: "Add an API key to research a new app.", code: "no_key" }, { status: 401 });

  const limit = await checkRateLimit(clientIp(req), { ownKey: resolved?.source === "browser" });
  if (!limit.ok) return Response.json({ error: limit.reason }, { status: 429 });

  const started = await startRun(q, key);
  if ("attach" in started) return ndjson([{ type: "attach", id: started.attach, key }]);
  const { run } = started;
  const work = runPipeline(run, { query: q, toolkitSlug: toolkit?.slug ?? null, creds: resolved?.creds ?? null }).catch(async (e) => {
    console.error("pipeline crashed:", redactKeys(errorText(e)).slice(0, 600));
    run.emit({ type: "error", message: "The run stopped unexpectedly. Try again.", retryable: true });
    await run.finish("error");
  });
  // Keep the function alive until the run finishes, even if the browser disconnects.
  after(() => work);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (e: RunEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
        if (e.type === "done" || e.type === "error") {
          closed = true;
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };
      for (const e of run.record.events) send(e);
      unsubscribe = subscribe(run.record.id, send);
      void work.finally(() => {
        if (!closed) {
          closed = true;
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });
    },
    cancel() {
      unsubscribe?.();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
