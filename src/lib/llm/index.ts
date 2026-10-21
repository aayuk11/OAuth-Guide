import { anthropicProvider, describeAnthropicError, validateAnthropicKey } from "./anthropic";
import { describeGoogleError, googleProvider, validateGoogleKey } from "./google";
import { describeOpenAIError, openaiProvider, validateOpenAIKey } from "./openai";
import { isProviderId, PROVIDER_IDS, PROVIDERS, type ProviderId } from "./catalog";
import type { Credentials, DescribedError, LlmProvider, Usage } from "./types";

export { isProviderId, PROVIDER_IDS, PROVIDERS, type KeyStatus, type ProviderId } from "./catalog";
export type { Credentials } from "./types";

export function createProvider(c: Credentials): LlmProvider {
  if (c.provider === "google") return googleProvider({ apiKey: c.apiKey, model: c.model });
  if (c.provider === "openai") return openaiProvider({ apiKey: c.apiKey, model: c.model });
  return anthropicProvider({ apiKey: c.apiKey, model: c.model, fallbacks: process.env.CLAUDE_FALLBACKS !== "off", dynamicWebTools: process.env.WEB_TOOLS === "dynamic" });
}

/** Plain words for a provider error. Pass the provider that made the call, so errors are not misattributed. */
export function describeProviderError(e: unknown, provider?: ProviderId | null): DescribedError {
  const generic = { message: "Something went wrong while calling the model.", retryable: true };
  if (provider === "anthropic") return describeAnthropicError(e) ?? generic;
  if (provider === "openai") return describeOpenAIError(e) ?? generic;
  if (provider === "google") return describeGoogleError(e) ?? generic;
  return describeAnthropicError(e) ?? describeOpenAIError(e) ?? describeGoogleError(e) ?? generic;
}

/** Checks a key with a cheap read-only call (list models). Never logs the key. */
export async function validateKey(provider: ProviderId, apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (provider === "anthropic") await validateAnthropicKey(apiKey);
    else if (provider === "google") await validateGoogleKey(apiKey);
    else await validateOpenAIKey(apiKey);
    return { ok: true };
  } catch (e) {
    const d = describeProviderError(e, provider);
    return { ok: false, error: d.message === "Something went wrong while calling the model." ? `${PROVIDERS[provider].vendor} did not accept this key.` : d.message };
  }
}

/**
 * Server-side credentials from environment variables. LLM_PROVIDER picks the provider; otherwise
 * the first provider with a key set is used. LLM_MODEL (or CLAUDE_MODEL for Anthropic) picks the model.
 */
export function envCredentials(): Credentials | null {
  const keyFor = (p: ProviderId) => PROVIDERS[p].envKeys.map((k) => process.env[k]).find((v) => v && v.trim());
  const wanted = process.env.LLM_PROVIDER;
  const order: ProviderId[] = isProviderId(wanted) ? [wanted] : PROVIDER_IDS;
  for (const p of order) {
    const apiKey = keyFor(p);
    if (!apiKey) continue;
    const model = process.env.LLM_MODEL || (p === "anthropic" ? process.env.CLAUDE_MODEL : undefined) || PROVIDERS[p].defaultModel;
    return { provider: p, apiKey: apiKey.trim(), model };
  }
  return null;
}

/** Estimated cost in USD, or null when the provider's prices for this model are not known here. */
export function estimateCost(provider: ProviderId, model: string, u: Usage): number | null {
  const info = PROVIDERS[provider];
  const p = info.prices[model];
  if (!p) return null;
  const usd = (u.input_tokens * p.in + u.output_tokens * p.out + u.cache_read * p.in * 0.1 + u.cache_write * p.in * 1.25) / 1_000_000 + u.searches * (info.searchUsd ?? 0);
  return Math.round(usd * 1000) / 1000;
}

export function providerLabel(provider: ProviderId, model: string): string {
  return `${PROVIDERS[provider].vendor} ${model}`;
}
