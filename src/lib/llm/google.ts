import { GoogleGenAI } from "@google/genai";
import { emptyUsage, errorText, SearchUnavailableError, SourceBook, type DescribedError, type ExtractRequest, type ExtractResult, type LlmProvider, type ResearchRequest, type ResearchResult, type Usage } from "./types";

/**
 * Google (Gemini) through the Interactions API: research with the google_search and url_context
 * tools, then a JSON-schema response with no tools. Both are streamed, so progress shows up live.
 * Gemini does not return page text, so the pipeline fetches cited pages itself before writing the
 * guide and before the critic checks quotes.
 */

// The stream is parsed defensively: every field is optional and unknown event types are ignored.
type Loose = Record<string, unknown>;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Loose => (v && typeof v === "object" ? (v as Loose) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * By default the SDK retries 429s and 5xx with backoff for 30 s up to an hour, which hid the real
 * error until our own time limit fired. Quota errors (429) are handled here instead, and timeouts
 * and 5xx get two quick retries.
 */
const RETRY = {
  retry_codes: ["408", "5XX"],
  retries: { strategy: "attempt-count-backoff" as const, maxRetries: 2, backoff: { initialInterval: 1000, maxInterval: 4000, exponent: 2 } },
};

/**
 * Free-tier keys get no Google Search on Gemini 3 models, but Google's pricing lists Search on
 * gemini-2.5-flash's free tier (up to 500 requests a day). Research falls back to it before giving up on search.
 */
export const FREE_SEARCH_MODEL = "gemini-2.5-flash";

/** A refusal that means "this key cannot do this", as opposed to a transient failure. */
const isRefusal = (e: unknown) => [400, 403, 404, 429].includes(num(obj(e).status));

/** thinking_level is a Gemini 3 setting; 2.5 models use a thinking budget and may reject it. */
const generationConfig = (model: string, effort: string, maxTokens: number) =>
  model.startsWith("gemini-2.") ? { max_output_tokens: maxTokens } : { thinking_level: effort as "low" | "medium" | "high", max_output_tokens: maxTokens };

function readUsage(u: unknown, into: Usage) {
  const x = obj(u);
  into.input_tokens = Math.max(into.input_tokens, num(x.total_input_tokens));
  into.output_tokens = Math.max(into.output_tokens, num(x.total_output_tokens) + num(x.total_thought_tokens));
  into.cache_read = Math.max(into.cache_read, num(x.total_cached_tokens));
  const searches = arr(x.grounding_tool_count).reduce<number>((n, g) => n + num(obj(g).count), 0);
  into.searches = Math.max(into.searches, searches);
}

function streamError(ev: Loose): Error {
  const err = obj(ev.error);
  return Object.assign(new Error(str(err.message) || "Gemini returned an error"), { status: num(err.code), provider: "google" });
}

/** Events that mean the model has started working (not just "interaction created"). */
const isProgress = (kind: string) => kind.startsWith("step.") || kind === "interaction.completed";

export function googleProvider(opts: { apiKey: string; model: string; client?: GoogleGenAI }): LlmProvider {
  const ai = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey });

  async function research(req: ResearchRequest): Promise<ResearchResult> {
    const book = new SourceBook();
    const searches: string[] = [];
    const usage = emptyUsage();
    let notes = "";
    let finalText = "";
    let timedOut = false;
    let status: string | null = null;
    let received = false;
    const seenQueries = new Set<string>();
    const seenUrls = new Set<string>();

    const onQueries = (qs: unknown) => {
      for (const q of arr(qs).map(str).filter(Boolean)) {
        if (seenQueries.has(q)) continue;
        seenQueries.add(q);
        searches.push(q);
        req.emit({ type: "search", query: q });
      }
    };
    const onOpen = (urls: unknown) => {
      for (const u of arr(urls).map(str).filter(Boolean)) req.emit({ type: "progress", stage: "research", detail: `Opening ${u}` });
    };
    const onUrlResults = (results: unknown) => {
      for (const r of arr(results).map(obj)) {
        const url = str(r.url);
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        const ok = str(r.status) === "success" || !r.status;
        book.add(url);
        usage.fetches++;
        req.emit({ type: "read", url, ok, error: ok ? undefined : str(r.status) });
      }
    };
    const onAnnotations = (anns: unknown) => {
      for (const a of arr(anns).map(obj)) if (str(a.type) === "url_citation" && str(a.url)) book.add(str(a.url), str(a.title));
    };
    const onStep = (step: Loose) => {
      const type = str(step.type);
      if (type === "google_search_call") onQueries(obj(step.arguments).queries);
      else if (type === "url_context_call") onOpen(obj(step.arguments).urls);
      else if (type === "url_context_result") onUrlResults(step.result);
      else if (type === "model_output")
        for (const c of arr(step.content).map(obj)) {
          if (str(c.type) === "text") notes += str(c.text);
          onAnnotations(c.annotations);
        }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, req.timeoutMs);

    const run = async (model: string) => {
      const stream = await ai.interactions.create(
        {
          model,
          system_instruction: req.system,
          input: req.prompt,
          tools: [{ type: "google_search" }, { type: "url_context" }],
          generation_config: generationConfig(model, req.effort, 16000),
          stream: true,
          store: false,
        },
        { fetch_options: { signal: controller.signal }, ...RETRY },
      );
      for await (const raw of stream) {
        const ev = obj(raw);
        const kind = str(ev.event_type);
        if (isProgress(kind)) received = true;
        if (kind === "step.start") onStep(obj(ev.step));
        else if (kind === "step.delta") {
          const d = obj(ev.delta);
          const t = str(d.type);
          if (t === "text") notes += str(d.text);
          else if (t === "text_annotation_delta") onAnnotations(d.annotations);
          else if (t === "google_search_call") onQueries(obj(d.arguments).queries);
          else if (t === "url_context_call") onOpen(obj(d.arguments).urls);
          else if (t === "url_context_result") onUrlResults(d.result);
          readUsage(obj(ev.metadata).total_usage, usage);
        } else if (kind === "step.stop") {
          readUsage(ev.usage, usage);
        } else if (kind === "interaction.completed" || kind === "interaction.status_update") {
          const it = obj(ev.interaction);
          status = str(it.status) || status;
          if (str(it.output_text)) finalText = str(it.output_text);
          for (const s of arr(it.steps).map(obj)) {
            // Text already arrived as deltas; take only citations from the final output steps.
            if (str(s.type) === "model_output") for (const c of arr(s.content).map(obj)) onAnnotations(c.annotations);
            else onStep(s);
          }
          readUsage(it.usage, usage);
        } else if (kind === "error") throw streamError(ev);
      }
    };

    let model = opts.model;
    try {
      try {
        await run(model);
      } catch (e) {
        // Refused before anything ran: on Gemini this is almost always Google Search quota (none on
        // the free tier for Gemini 3 models). Try the model whose free tier includes Search.
        if (timedOut || received || num(obj(e).status) !== 429 || model === FREE_SEARCH_MODEL) throw e;
        req.emit({ type: "step", stage: "research", status: "running", detail: `Google Search is not included for ${model} on this key's plan; researching with ${FREE_SEARCH_MODEL}, whose free tier includes it` });
        model = FREE_SEARCH_MODEL;
        try {
          await run(model);
        } catch (e2) {
          if (timedOut || received || !isRefusal(e2)) throw e2;
          throw new SearchUnavailableError(`${errorText(e)} | ${FREE_SEARCH_MODEL}: ${errorText(e2)}`);
        }
      }
    } catch (e) {
      if (e instanceof SearchUnavailableError) throw e;
      if (!timedOut && !received && num(obj(e).status) === 429) throw new SearchUnavailableError(errorText(e));
      if (!timedOut) throw e;
      /* time limit: keep what arrived */
    } finally {
      clearTimeout(timer);
    }
    const text = (finalText || notes).trim();
    return { notes: text, sources: book.all(), searches, usage, stopReason: status, timedOut, refused: false, model };
  }

  async function extract(req: ExtractRequest): Promise<ExtractResult> {
    const usage = emptyUsage();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, req.timeoutMs);
    let text = "";
    let finalText = "";
    let status = "";
    // Streamed, so a slow or overloaded model is visible: "waiting" until the first characters arrive.
    const started = Date.now();
    const progress = setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      req.emit({ type: "progress", stage: "extract", detail: text ? `Writing guide (${Math.round(text.length / 1000)}k characters so far)` : `Waiting for Gemini to start writing (${s} s)` });
    }, 3000);

    const run = async (model: string) => {
      const stream = await ai.interactions.create(
        {
          model,
          system_instruction: req.system,
          input: req.input,
          response_format: { type: "text", mime_type: "application/json", schema: req.schema },
          generation_config: generationConfig(model, req.effort, 24000),
          stream: true,
          store: false,
        },
        { fetch_options: { signal: controller.signal }, ...RETRY },
      );
      for await (const raw of stream) {
        const ev = obj(raw);
        const kind = str(ev.event_type);
        if (kind === "step.delta") {
          const d = obj(ev.delta);
          if (str(d.type) === "text") text += str(d.text);
          readUsage(obj(ev.metadata).total_usage, usage);
        } else if (kind === "step.start") {
          const step = obj(ev.step);
          if (str(step.type) === "model_output") for (const c of arr(step.content).map(obj)) if (str(c.type) === "text") text += str(c.text);
        } else if (kind === "step.stop") readUsage(ev.usage, usage);
        else if (kind === "interaction.completed" || kind === "interaction.status_update") {
          const it = obj(ev.interaction);
          status = str(it.status) || status;
          if (str(it.output_text)) finalText = str(it.output_text);
          readUsage(it.usage, usage);
        } else if (kind === "error") throw streamError(ev);
      }
    };

    try {
      try {
        await run(opts.model);
      } catch (e) {
        // The chosen model has no quota on this key (common on the free tier): write with the
        // model whose free tier research already fell back to.
        if (timedOut || text || num(obj(e).status) !== 429 || opts.model === FREE_SEARCH_MODEL) throw e;
        req.emit({ type: "progress", stage: "extract", detail: `${opts.model} has no quota on this key; writing with ${FREE_SEARCH_MODEL}` });
        await run(FREE_SEARCH_MODEL);
      }
      const out = (finalText || text).trim();
      if (status && status !== "completed") return { text: out || null, usage, error: status === "incomplete" ? "The guide was too long to finish." : `Gemini finished with status "${status}".`, timedOut };
      return { text: out || null, usage, error: out ? undefined : "Gemini returned no text.", timedOut };
    } catch (e) {
      if (timedOut)
        return {
          text: null,
          usage,
          error: text ? "Writing the guide timed out." : `Gemini did not start answering within ${Math.round(req.timeoutMs / 1000)} s. The model may be overloaded; try again in a few minutes.`,
          timedOut: true,
        };
      throw e;
    } finally {
      clearTimeout(timer);
      clearInterval(progress);
    }
  }

  return { id: "google", model: opts.model, research, extract };
}

export function describeGoogleError(e: unknown): DescribedError | null {
  const status = num(obj(e).status) || num(obj(e).code);
  if (!status) return null;
  const text = errorText(e);
  // Google reports a bad key as 400 INVALID_ARGUMENT rather than 401.
  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(text)) return { message: "The Gemini API key was rejected.", retryable: false };
  if (status === 429) return describeQuota(text);
  if (status === 400) return { message: `Gemini rejected the request: ${str(obj(e).message).slice(0, 200)}`, retryable: false };
  if (status === 401 || status === 403) return { message: "The Gemini API key was rejected, or it cannot use this model.", retryable: false };
  if (status === 404) return { message: "Gemini does not recognise that model name.", retryable: false };
  if (status === 503 || /overloaded|UNAVAILABLE/i.test(text)) return { message: "Gemini is overloaded right now (HTTP 503). Try again in a few minutes.", retryable: true };
  if (status >= 500) return { message: `Gemini had an error (HTTP ${status}). Try again shortly.`, retryable: true };
  return { message: `Gemini API error (${status}).`, retryable: true };
}

/** Google's 429 text names the quota that ran out ("Quota exceeded for metric: …, limit: N"); say which. */
export function describeQuota(text: string): DescribedError {
  const m = /Quota exceeded for metric:\s*([^\s,]+)(?:,\s*limit:\s*(\d+))?(?:,\s*model:\s*([\w.-]+))?/i.exec(text);
  const retry = /retry in ([\d.]+)\s*s/i.exec(text);
  const model = m?.[3] ? ` for ${m[3]}` : "";
  if (m?.[2] === "0" || /limit:\s*0\b/.test(text))
    return { message: `This Gemini key's plan has no quota${model}. Pick another model under AI key, or enable billing for the key's project in Google AI Studio.`, retryable: false };
  if (/per_?day|PerDay/i.test(m?.[1] ?? text))
    return { message: `This Gemini key has used today's quota${model}. Free-tier quotas reset at midnight Pacific time; enabling billing in Google AI Studio raises them.`, retryable: false };
  return { message: `Gemini is rate-limiting this key${model}${retry ? `; try again in ${Math.ceil(Number(retry[1]))} s` : "; try again in a minute"}.`, retryable: true };
}

export async function validateGoogleKey(apiKey: string): Promise<void> {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 10_000 } });
  await ai.models.list({ config: { pageSize: 1 } });
}
