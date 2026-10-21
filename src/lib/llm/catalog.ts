/** Provider facts with no SDK imports, so both the server and the key form in the browser can use them. */

export type ProviderId = "anthropic" | "google" | "openai";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  vendor: string;
  defaultModel: string;
  models: string[];
  keyUrl: string;
  envKeys: string[];
  /** USD per million tokens, where the provider publishes it; a missing model means "not estimated". */
  prices: Record<string, { in: number; out: number }>;
  searchUsd: number | null;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Claude",
    vendor: "Anthropic",
    defaultModel: "claude-sonnet-5-5",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
    keyUrl: "https://console.anthropic.com/settings/keys",
    envKeys: ["ANTHROPIC_API_KEY"],
    prices: { "claude-sonnet-5-5": { in: 2, out: 10 }, "claude-opus-5-5": { in: 4, out: 20 }, "claude-haiku-5-5": { in: 0.1, out: 0.5 } },
    searchUsd: 0.01,
  },
  google: {
    id: "google",
    label: "Gemini",
    vendor: "Google",
    defaultModel: "gemini-3.8-flash",
    models: ["gemini-3.8-flash", "gemini-4-argon", "gemini-3.5-flash-lite"],
    keyUrl: "https://aistudio.google.com/apikey",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    prices: {},
    searchUsd: null,
  },
  openai: {
    id: "openai",
    label: "GPT",
    vendor: "OpenAI",
    defaultModel: "gpt-6.1-sol",
    models: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"],
    keyUrl: "https://platform.openai.com/api-keys",
    envKeys: ["OPENAI_API_KEY"],
    prices: { "gpt-6.1-sol": { in: 2, out: 10 }, "gpt-6-astra": { in: 10, out: 50 }, "gpt-6-luna": { in: 0.1, out: 0.5 } },
    searchUsd: null,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && Object.hasOwn(PROVIDERS, v);
}

/** What the browser is told about the active key. Never contains the key itself. */
export interface KeyStatus {
  active: "browser" | "server" | null;
  browser: { provider: ProviderId; vendor: string; model: string; hint: string } | null;
  server: { provider: ProviderId; vendor: string; model: string } | null;
}
