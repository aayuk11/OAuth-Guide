import OpenAI from "openai";
import { emptyUsage, SourceBook, type DescribedError, type ExtractRequest, type ExtractResult, type LlmProvider, type ResearchRequest, type ResearchResult } from "./types";

/**
 * OpenAI through the Responses API: research with the web_search tool (streamed), then a
 * strict JSON-schema response with no tools. Like Gemini, page text is not returned, so the
 * pipeline fetches cited pages itself before writing the guide and checking quotes.
 */

type Loose = Record<string, unknown>;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Loose => (v && typeof v === "object" ? (v as Loose) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function openaiProvider(opts: { apiKey: string; model: string; client?: OpenAI }): LlmProvider {
  const client = opts.client ?? new OpenAI({ apiKey: opts.apiKey, maxRetries: 2, timeout: 240_000 });

  async function research(req: ResearchRequest): Promise<ResearchResult> {
    const book = new SourceBook();
    const searches: string[] = [];
    const usage = emptyUsage();
    let notes = "";
    let timedOut = false;
    let status: string | null = null;
    const seen = new Set<string>();

    const onItem = (item: Loose) => {
      if (str(item.type) === "web_search_call") {
        const action = obj(item.action);
        const kind = str(action.type);
        const id = str(item.id);
        if (seen.has(id)) return;
        seen.add(id);
        if (kind === "search") {
          const qs = [...arr(action.queries).map(str), str(action.query)].filter(Boolean);
          for (const q of [...new Set(qs)]) {
            searches.push(q);
            req.emit({ type: "search", query: q });
          }
          for (const s of arr(action.sources).map(obj)) if (str(s.url)) book.add(str(s.url));
          usage.searches++;
        } else if (kind === "open_page" && str(action.url)) {
          book.add(str(action.url));
          usage.fetches++;
          req.emit({ type: "read", url: str(action.url), ok: true });
        }
      } else if (str(item.type) === "message") {
        for (const c of arr(item.content).map(obj)) {
          if (str(c.type) !== "output_text") continue;
          for (const a of arr(c.annotations).map(obj)) if (str(a.type) === "url_citation" && str(a.url)) book.add(str(a.url), str(a.title));
        }
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, req.timeoutMs);
    try {
      const stream = await client.responses.create(
        {
          model: opts.model,
          instructions: req.system,
          input: req.prompt,
          tools: [{ type: "web_search" }],
          include: ["web_search_call.action.sources"],
          reasoning: { effort: req.effort },
          max_output_tokens: 16000,
          stream: true,
          store: false,
        },
        { signal: controller.signal },
      );
      for await (const ev of stream) {
        const e = ev as unknown as Loose;
        const type = str(e.type);
        if (type === "response.output_item.done") onItem(obj(e.item));
        else if (type === "response.output_text.delta") notes += str(e.delta);
        else if (type === "response.completed" || type === "response.incomplete") {
          const r = obj(e.response);
          status = str(r.status) || type;
          for (const item of arr(r.output).map(obj)) onItem(item);
          const u = obj(r.usage);
          usage.input_tokens = num(u.input_tokens);
          usage.output_tokens = num(u.output_tokens);
          usage.cache_read = num(obj(u.input_tokens_details).cached_tokens);
          const text = arr(r.output)
            .map(obj)
            .filter((i) => str(i.type) === "message")
            .flatMap((i) => arr(i.content).map(obj))
            .filter((c) => str(c.type) === "output_text")
            .map((c) => str(c.text))
            .join("");
          if (text) notes = text;
        } else if (type === "response.failed" || type === "error") {
          const err = obj(obj(e.response).error ?? e);
          throw Object.assign(new Error(str(err.message) || "OpenAI returned an error"), { provider: "openai", code: str(err.code) });
        }
      }
    } catch (e) {
      if (!(e instanceof OpenAI.APIUserAbortError) && !timedOut) throw e;
    } finally {
      clearTimeout(timer);
    }
    return { notes: notes.trim(), sources: book.all(), searches, usage, stopReason: status, timedOut, refused: false };
  }

  async function extract(req: ExtractRequest): Promise<ExtractResult> {
    const usage = emptyUsage();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, req.timeoutMs);
    const progress = setInterval(() => req.emit({ type: "progress", stage: "extract", detail: "Writing guide…" }), 5000);
    try {
      const r = await client.responses.create(
        {
          model: opts.model,
          instructions: req.system,
          input: req.input,
          text: { format: { type: "json_schema", name: "guide_draft", schema: req.schema, strict: true } },
          reasoning: { effort: req.effort },
          max_output_tokens: 24000,
          store: false,
        },
        { signal: controller.signal },
      );
      usage.input_tokens = r.usage?.input_tokens ?? 0;
      usage.output_tokens = r.usage?.output_tokens ?? 0;
      if (r.status === "incomplete") return { text: null, usage, error: "The guide was too long to finish.", timedOut };
      const refusal = r.output.flatMap((i) => (i.type === "message" ? i.content : [])).find((c) => c.type === "refusal");
      if (refusal) return { text: null, usage, error: "The model declined to write this guide.", timedOut };
      return { text: r.output_text || null, usage, error: r.output_text ? undefined : "OpenAI returned no text.", timedOut };
    } catch (e) {
      if (e instanceof OpenAI.APIUserAbortError || timedOut) return { text: null, usage, error: "Writing the guide timed out.", timedOut: true };
      throw e;
    } finally {
      clearTimeout(timer);
      clearInterval(progress);
    }
  }

  return { id: "openai", model: opts.model, research, extract };
}

export function describeOpenAIError(e: unknown): DescribedError | null {
  // Errors reported inside the stream arrive as plain errors tagged by openaiProvider.
  if (obj(e).provider === "openai") {
    const code = str(obj(e).code);
    if (/rate_limit|insufficient_quota/.test(code)) return { message: "OpenAI is rate-limiting requests or the key is out of credit. Try again later.", retryable: true };
    return { message: `OpenAI stopped the response: ${str(obj(e).message).slice(0, 200) || "unknown error"}`, retryable: true };
  }
  if (e instanceof OpenAI.AuthenticationError) return { message: "The OpenAI API key was rejected.", retryable: false };
  if (e instanceof OpenAI.PermissionDeniedError) return { message: "The OpenAI key cannot use this model or tool.", retryable: false };
  if (e instanceof OpenAI.NotFoundError) return { message: "OpenAI does not recognise that model name.", retryable: false };
  if (e instanceof OpenAI.RateLimitError) return { message: "OpenAI is rate-limiting requests or the key is out of credit. Try again later.", retryable: true };
  if (e instanceof OpenAI.BadRequestError) return { message: `OpenAI rejected the request: ${e.message.slice(0, 200)}`, retryable: false };
  if (e instanceof OpenAI.InternalServerError) return { message: "OpenAI had an error or is overloaded. Try again shortly.", retryable: true };
  if (e instanceof OpenAI.APIConnectionError) return { message: "Could not reach OpenAI.", retryable: true };
  if (e instanceof OpenAI.APIError) return { message: `OpenAI API error (${e.status ?? "unknown"}).`, retryable: true };
  return null;
}

export async function validateOpenAIKey(apiKey: string): Promise<void> {
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 10_000 });
  await client.models.list();
}
