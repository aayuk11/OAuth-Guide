/** Agent limits. Every knob is an environment variable so operators never edit code. */

function int(name: string, fallback: number, min: number, max: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

export type Effort = "low" | "medium" | "high";
function effort(names: string[], fallback: Effort): Effort {
  for (const n of names) {
    const v = process.env[n];
    if (v === "low" || v === "medium" || v === "high") return v;
  }
  return fallback;
}

export const agentConfig = () => ({
  researchEffort: effort(["LLM_RESEARCH_EFFORT", "CLAUDE_RESEARCH_EFFORT"], "medium"),
  extractEffort: effort(["LLM_EXTRACT_EFFORT", "CLAUDE_EXTRACT_EFFORT"], "low"),
  maxSearches: int("MAX_SEARCHES", 6, 1, 15),
  maxFetches: int("MAX_FETCHES", 6, 0, 15),
  /** Pages the server reads itself so quotes can be checked, whichever model ran the research. */
  verifyFetches: int("VERIFY_FETCHES", 8, 0, 20),
  researchTimeoutMs: int("RESEARCH_TIMEOUT_MS", 150_000, 20_000, 240_000),
  extractTimeoutMs: int("EXTRACT_TIMEOUT_MS", 110_000, 20_000, 200_000),
  /** Runs per IP per hour and per day overall. */
  perIpHourly: int("RUNS_PER_IP_PER_HOUR", 20, 1, 1000),
  dailyCap: int("DAILY_RUN_CAP", 150, 1, 100_000),
  /** Generated guides are reused for this many days. */
  cacheDays: int("GUIDE_CACHE_DAYS", 7, 1, 90),
  /** Test-only: replace the model with a deterministic fixture. Never on by default. */
  mock: process.env.AGENT_MOCK === "1",
});
