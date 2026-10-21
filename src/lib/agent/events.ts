import type { EvidenceLabel } from "@/lib/guide/schema";

export const STAGES = [
  { id: "resolve", label: "Identify the app" },
  { id: "composio", label: "Check Composio's catalogue" },
  { id: "probe", label: "Probe OAuth discovery endpoints" },
  { id: "research", label: "Research the provider's docs" },
  { id: "extract", label: "Write the guide" },
  { id: "verify", label: "Test what the agent found" },
  { id: "critic", label: "Check every quote against its source" },
  { id: "save", label: "Save and share" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];

export type RunEvent = { t: number } & (
  | { type: "run"; id: string; key: string; query: string }
  | { type: "step"; stage: StageId; status: "running" | "done" | "skipped" | "failed"; detail?: string }
  | { type: "search"; query: string }
  | { type: "read"; url: string; title?: string; ok: boolean; error?: string }
  | { type: "finding"; text: string; label: EvidenceLabel }
  | { type: "progress"; stage: StageId; detail: string }
  | { type: "candidates"; reason: string; options: { slug: string; name: string; kind: string }[] }
  | { type: "redirect"; url: string; reason: string }
  | { type: "guide"; key: string; url: string; partial: boolean }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "done"; url?: string }
);

/** Distributes Omit over the union so each event variant keeps its own fields. */
export type RunEventInput = RunEvent extends infer E ? (E extends RunEvent ? Omit<E, "t"> : never) : never;

export type RunStatus = "running" | "done" | "partial" | "error" | "candidates" | "redirect";

export interface RunRecord {
  id: string;
  key: string;
  query: string;
  status: RunStatus;
  events: RunEvent[];
  guideKey?: string;
  startedAt: string;
  finishedAt?: string;
  model?: string;
  provider?: string;
  /** cost_usd is null when the provider's prices are not known here. */
  usage?: { input_tokens: number; output_tokens: number; searches: number; fetches: number; cost_usd: number | null };
}
