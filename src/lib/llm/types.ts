import type { RunEventInput } from "@/lib/agent/events";

/**
 * The live agent talks to models through this interface, so any provider with web search
 * and structured output can drive it. Everything else (stage order, page fetching for
 * evidence, the critic, scoring) stays in code and behaves the same whichever model runs.
 */

import type { ProviderId } from "./catalog";
export type { ProviderId };

export interface Credentials {
  provider: ProviderId;
  apiKey: string;
  model: string;
}

/** A page or search result the research step saw. Text is filled by the provider or by our own fetch. */
export interface Source {
  id: string;
  url: string;
  title: string;
  fetched: boolean;
  text: string;
  cited: string[];
  pageAge: string | null;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
  searches: number;
  fetches: number;
}

export function emptyUsage(): Usage {
  return { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, searches: 0, fetches: 0 };
}

export interface ResearchResult {
  notes: string;
  sources: Source[];
  searches: string[];
  usage: Usage;
  stopReason: string | null;
  timedOut: boolean;
  refused: boolean;
  /** The model that did the research, when it differs from the one chosen (Gemini free-tier search fallback). */
  model?: string;
}

export interface ResearchRequest {
  system: string;
  prompt: string;
  maxSearches: number;
  maxFetches: number;
  timeoutMs: number;
  effort: "low" | "medium" | "high";
  emit: (e: RunEventInput) => void;
}

export interface ExtractRequest {
  system: string;
  input: string;
  /**
   * Strict JSON Schema (every property required, additionalProperties false) for structured output,
   * or null for plain JSON mode when a provider cannot compile the schema. The caller validates either way.
   */
  schema: Record<string, unknown> | null;
  timeoutMs: number;
  effort: "low" | "medium" | "high";
  emit: (e: RunEventInput) => void;
}

export interface ExtractResult {
  /** The model's JSON text, validated by the caller. */
  text: string | null;
  usage: Usage;
  error?: string;
  timedOut: boolean;
}

export interface LlmProvider {
  id: ProviderId;
  model: string;
  research(req: ResearchRequest): Promise<ResearchResult>;
  extract(req: ExtractRequest): Promise<ExtractResult>;
}

/** Turns provider SDK errors into messages a user can act on. */
export interface DescribedError {
  message: string;
  retryable: boolean;
}

/**
 * Thrown by research() when the key cannot use the provider's web search at all (for example,
 * Gemini free-tier keys have no Google Search quota on Gemini 3 models). The pipeline then reads
 * the provider's official pages by URL instead.
 */
export class SearchUnavailableError extends Error {
  constructor(readonly reason: string) {
    super("Web search is not available for this key.");
    this.name = "SearchUnavailableError";
  }
}

/** Every piece of text an SDK error carries (message, raw body, parsed error), for matching reasons. */
export function errorText(e: unknown): string {
  if (!e || typeof e !== "object") return String(e ?? "");
  const x = e as Record<string, unknown>;
  const parts = [x.message, x.body, x.error].map((v) => (typeof v === "string" ? v : v ? JSON.stringify(v) : ""));
  return parts.filter(Boolean).join(" ");
}

/** For server logs: provider errors never contain the key, but strip anything key-shaped anyway. */
export function redactKeys(s: string): string {
  return s.replace(/\b(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,})/g, "[key]").replace(/([?&]key=)[^&\s"]+/g, "$1[key]");
}

/** Collects sources by URL and hands out stable ids S1, S2, ... */
export class SourceBook {
  private map = new Map<string, Source>();
  add(url: string, title = ""): Source {
    const key = url.split("#")[0];
    let s = this.map.get(key);
    if (!s) {
      s = { id: `S${this.map.size + 1}`, url: key, title: title || key, fetched: false, text: "", cited: [], pageAge: null };
      this.map.set(key, s);
    } else if (title && s.title === s.url) s.title = title;
    return s;
  }
  get(url: string): Source | undefined {
    return this.map.get(url.split("#")[0]);
  }
  all(): Source[] {
    return [...this.map.values()];
  }
}
