import { randomBytes } from "node:crypto";
import { store } from "@/lib/store";
import type { Guide } from "@/lib/guide/schema";
import { agentConfig } from "./config";
import type { RunEvent, RunEventInput, RunRecord, RunStatus } from "./events";

/** Runs are persisted event by event, so a closed tab or a second viewer can follow or reopen them. */

const RUN_TTL = 60 * 60 * 24 * 7;
const INFLIGHT_TTL = 330;

type Listener = (e: RunEvent) => void;
const g = globalThis as unknown as { __runListeners?: Map<string, Set<Listener>> };
const listeners = (g.__runListeners ??= new Map());

export function newRunId(): string {
  return randomBytes(9).toString("base64url");
}

export interface RunHandle {
  record: RunRecord;
  emit: (e: RunEventInput) => void;
  finish: (status: RunStatus, extra?: Partial<RunRecord>) => Promise<void>;
  flush: () => Promise<void>;
}

export async function createRun(query: string, key: string): Promise<RunHandle> {
  const started = Date.now();
  const record: RunRecord = { id: newRunId(), key, query, status: "running", events: [], startedAt: new Date(started).toISOString() };
  let chain: Promise<void> = Promise.resolve();
  const persist = () => {
    const snapshot = structuredClone(record);
    chain = chain.then(() => store().set(`run:${record.id}`, snapshot, RUN_TTL)).catch(() => {});
    return chain;
  };
  const emit = (input: RunEventInput) => {
    const e = { ...input, t: Date.now() - started } as RunEvent;
    record.events.push(e);
    for (const fn of listeners.get(record.id) ?? []) fn(e);
    void persist();
  };
  const finish = async (status: RunStatus, extra: Partial<RunRecord> = {}) => {
    Object.assign(record, extra, { status, finishedAt: new Date().toISOString() });
    await persist();
    await store().del(`inflight:${key}`).catch(() => {});
  };
  emit({ type: "run", id: record.id, key, query });
  await store().set(`inflight:${key}`, record.id, INFLIGHT_TTL).catch(() => {});
  return { record, emit, finish, flush: () => chain };
}

export function subscribe(id: string, fn: Listener): () => void {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(id);
  };
}

export async function getRun(id: string): Promise<RunRecord | null> {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return null;
  return store().get<RunRecord>(`run:${id}`);
}

export async function inflightRun(key: string): Promise<string | null> {
  return store().get<string>(`inflight:${key}`);
}

export interface RecentItem {
  key: string;
  name: string;
  at: string;
  partial: boolean;
}

export async function saveGeneratedGuide(guide: Guide): Promise<void> {
  const ttl = agentConfig().cacheDays * 86400;
  await store().set(`guide:${guide.slug}`, guide, ttl);
  const recent = (await store().get<RecentItem[]>("recent")) ?? [];
  const next = [{ key: guide.slug, name: guide.app.name, at: new Date().toISOString(), partial: !!guide.meta?.partial }, ...recent.filter((r) => r.key !== guide.slug)].slice(0, 24);
  await store().set("recent", next, ttl);
}

export async function getGeneratedGuide(key: string): Promise<Guide | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(key)) return null;
  return store().get<Guide>(`guide:${key}`);
}

export async function recentGuides(): Promise<RecentItem[]> {
  return (await store().get<RecentItem[]>("recent").catch(() => null)) ?? [];
}

/** Per-IP hourly limit plus a global daily cap. */
/**
 * Per-network hourly limit for every run. The daily cap protects the deployment's own key,
 * so runs paid for with a visitor's key do not count against it.
 */
export async function checkRateLimit(ip: string, opts: { ownKey: boolean } = { ownKey: false }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cfg = agentConfig();
  const hour = new Date().toISOString().slice(0, 13);
  const day = hour.slice(0, 10);
  const perIp = await store().incr(`rl:ip:${ip}:${hour}`, 3600);
  if (perIp > cfg.perIpHourly) return { ok: false, reason: `Limit reached: ${cfg.perIpHourly} live runs per hour from one network. The library still works; try again later.` };
  if (opts.ownKey) return { ok: true };
  const daily = await store().incr(`rl:day:${day}`, 2 * 86400);
  if (daily > cfg.dailyCap) return { ok: false, reason: "Today's live research budget on this site's key is used up. Add your own API key under AI key, or try again tomorrow." };
  return { ok: true };
}
