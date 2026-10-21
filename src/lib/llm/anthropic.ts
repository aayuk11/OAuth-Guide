import Anthropic from "@anthropic-ai/sdk";
import { emptyUsage, SourceBook, type DescribedError, type ExtractRequest, type ExtractResult, type LlmProvider, type ResearchRequest, type ResearchResult, type Usage } from "./types";

/**
 * Anthropic (Claude): research with the server-side web_search and web_fetch tools, then a
 * structured-output call with no tools. Fetched page text comes back in the response, so the
 * critic can check quotes against exactly what the model read.
 */

function addUsage(u: Usage, m: Anthropic.Beta.Messages.BetaMessage) {
  u.input_tokens += m.usage.input_tokens ?? 0;
  u.output_tokens += m.usage.output_tokens ?? 0;
  u.cache_read += m.usage.cache_read_input_tokens ?? 0;
  u.cache_write += m.usage.cache_creation_input_tokens ?? 0;
  u.searches += m.usage.server_tool_use?.web_search_requests ?? 0;
  u.fetches += m.usage.server_tool_use?.web_fetch_requests ?? 0;
}

export function anthropicProvider(opts: { apiKey: string; model: string; fallbacks?: boolean; dynamicWebTools?: boolean; client?: Anthropic }): LlmProvider {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 240_000 });
  const fallbacks = opts.fallbacks !== false;
  const extra = fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};

  async function research(req: ResearchRequest): Promise<ResearchResult> {
    const book = new SourceBook();
    const searches: string[] = [];
    const usage = emptyUsage();
    const notes: string[] = [];
    const fetchTargets = new Map<string, string>();
    let stopReason: string | null = null;
    let timedOut = false;
    let refused = false;

    const handleBlock = (block: Anthropic.Beta.Messages.BetaContentBlock) => {
      if (block.type === "server_tool_use") {
        const input = block.input as { query?: string; url?: string };
        if (block.name === "web_search" && input.query) {
          searches.push(input.query);
          req.emit({ type: "search", query: input.query });
        } else if (block.name === "web_fetch" && input.url) {
          fetchTargets.set(block.id, input.url);
          req.emit({ type: "progress", stage: "research", detail: `Opening ${input.url}` });
        }
      } else if (block.type === "web_search_tool_result") {
        if (Array.isArray(block.content)) {
          for (const r of block.content) book.add(r.url, r.title).pageAge = r.page_age ?? null;
          req.emit({ type: "progress", stage: "research", detail: `${block.content.length} results` });
        }
      } else if (block.type === "web_fetch_tool_result") {
        const c = block.content;
        if (c.type === "web_fetch_result") {
          const doc = c.content;
          const s = book.add(c.url, doc.title ?? "");
          s.fetched = true;
          if (doc.source.type === "text") s.text = doc.source.data;
          req.emit({ type: "read", url: c.url, title: doc.title ?? undefined, ok: true });
        } else {
          req.emit({ type: "read", url: fetchTargets.get(block.tool_use_id) ?? "", ok: false, error: c.error_code });
        }
      } else if (block.type === "text") {
        notes.push(block.text);
        for (const cit of block.citations ?? []) {
          if (cit.type === "web_search_result_location") book.add(cit.url, cit.title ?? "").cited.push(cit.cited_text);
        }
      }
    };

    const tools: Anthropic.Beta.Messages.BetaToolUnion[] = opts.dynamicWebTools
      ? [
          { type: "web_search_20260209", name: "web_search", max_uses: req.maxSearches },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: req.maxFetches, max_content_tokens: 9000 },
        ]
      : [
          { type: "web_search_20250305", name: "web_search", max_uses: req.maxSearches },
          { type: "web_fetch_20250910", name: "web_fetch", max_uses: req.maxFetches, max_content_tokens: 9000 },
        ];
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: req.prompt }];
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, req.timeoutMs);
    try {
      for (let turn = 0; turn < 4; turn++) {
        const stream = client.beta.messages.stream(
          { model: opts.model, max_tokens: 16000, system: req.system, messages, tools, output_config: { effort: req.effort }, ...extra },
          { signal: controller.signal },
        );
        stream.on("contentBlock", handleBlock);
        const msg = await stream.finalMessage();
        addUsage(usage, msg);
        stopReason = msg.stop_reason;
        if (msg.stop_reason === "refusal") {
          refused = true;
          break;
        }
        if (msg.stop_reason !== "pause_turn") break;
        // The server-side tool loop paused: send the turn back unchanged and the API resumes it.
        messages.push({ role: "assistant", content: msg.content });
      }
    } catch (e) {
      if (!(e instanceof Anthropic.APIUserAbortError) && !timedOut) throw e;
    } finally {
      clearTimeout(timer);
    }
    return { notes: notes.join("").trim(), sources: book.all(), searches, usage, stopReason, timedOut, refused };
  }

  async function extract(req: ExtractRequest): Promise<ExtractResult> {
    const usage = emptyUsage();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, req.timeoutMs);
    let chars = 0;
    let lastEmit = Date.now();
    try {
      const stream = client.beta.messages.stream(
        {
          model: opts.model,
          max_tokens: 24000,
          system: req.system,
          messages: [{ role: "user", content: req.input }],
          output_config: { effort: req.effort, format: { type: "json_schema", schema: req.schema } },
          ...extra,
        },
        { signal: controller.signal },
      );
      stream.on("text", (delta) => {
        chars += delta.length;
        if (Date.now() - lastEmit > 2500) {
          lastEmit = Date.now();
          req.emit({ type: "progress", stage: "extract", detail: `Writing guide (${Math.round(chars / 1000)}k characters so far)` });
        }
      });
      const msg = await stream.finalMessage();
      usage.input_tokens += msg.usage.input_tokens ?? 0;
      usage.output_tokens += msg.usage.output_tokens ?? 0;
      if (msg.stop_reason === "refusal") return { text: null, usage, error: "The model declined to write this guide.", timedOut };
      if (msg.stop_reason === "max_tokens") return { text: null, usage, error: "The guide was too long to finish.", timedOut };
      return { text: msg.content.map((b) => (b.type === "text" ? b.text : "")).join(""), usage, timedOut };
    } catch (e) {
      if (e instanceof Anthropic.APIUserAbortError || timedOut) return { text: null, usage, error: "Writing the guide timed out.", timedOut: true };
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  return { id: "anthropic", model: opts.model, research, extract };
}

export function describeAnthropicError(e: unknown): DescribedError | null {
  if (e instanceof Anthropic.AuthenticationError) return { message: "The Anthropic API key was rejected.", retryable: false };
  if (e instanceof Anthropic.PermissionDeniedError) return { message: "The Anthropic key cannot use this model or tool (web search may be disabled for the organisation).", retryable: false };
  if (e instanceof Anthropic.NotFoundError) return { message: "Anthropic does not recognise that model name.", retryable: false };
  if (e instanceof Anthropic.RateLimitError) return { message: "Anthropic is rate-limiting requests. Try again in a minute.", retryable: true };
  if (e instanceof Anthropic.BadRequestError) return { message: `Anthropic rejected the request: ${e.message.slice(0, 200)}`, retryable: false };
  if (e instanceof Anthropic.InternalServerError) return { message: "Anthropic had an error or is overloaded. Try again shortly.", retryable: true };
  if (e instanceof Anthropic.APIConnectionError) return { message: "Could not reach Anthropic.", retryable: true };
  if (e instanceof Anthropic.APIError) return { message: `Anthropic API error (${e.status ?? "unknown"}).`, retryable: true };
  return null;
}

export async function validateAnthropicKey(apiKey: string): Promise<void> {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 10_000 });
  await client.models.list({ limit: 1 });
}
