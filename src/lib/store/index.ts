import fs from "node:fs";
import path from "node:path";

/**
 * Key-value storage with three backends, chosen automatically:
 * 1. Upstash Redis over REST, when UPSTASH_REDIS_REST_URL/TOKEN (or Vercel's KV_REST_API_URL/TOKEN) are set.
 *    Needed for durable share links on serverless hosts.
 * 2. Local JSON files under .data/, when the filesystem is writable (local dev, a VM, a container).
 * 3. Process memory, as a last resort (serverless without Upstash: links live as long as the instance).
 */
export interface Store {
  readonly kind: "upstash" | "file" | "memory";
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Increment a counter, setting the TTL when it is created. Returns the new value. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Set only if the key does not exist (atomic on Upstash). Returns whether it was set. */
  setIfAbsent(key: string, value: unknown, ttlSeconds: number): Promise<boolean>;
}

class UpstashStore implements Store {
  readonly kind = "upstash" as const;
  constructor(
    private url: string,
    private token: string,
  ) {}
  private async cmd<T>(args: (string | number)[]): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstash ${args[0]} failed: HTTP ${res.status}`);
    const body = (await res.json()) as { result: T; error?: string };
    if (body.error) throw new Error(`Upstash ${args[0]} failed: ${body.error}`);
    return body.result;
  }
  async get<T>(key: string) {
    const v = await this.cmd<string | null>(["GET", key]);
    return v == null ? null : (JSON.parse(v) as T);
  }
  async set(key: string, value: unknown, ttl?: number) {
    await this.cmd(ttl ? ["SET", key, JSON.stringify(value), "EX", ttl] : ["SET", key, JSON.stringify(value)]);
  }
  async del(key: string) {
    await this.cmd(["DEL", key]);
  }
  async incr(key: string, ttl: number) {
    const n = await this.cmd<number>(["INCR", key]);
    if (n === 1) await this.cmd(["EXPIRE", key, ttl]);
    return n;
  }
  async setIfAbsent(key: string, value: unknown, ttl: number) {
    return (await this.cmd<string | null>(["SET", key, JSON.stringify(value), "NX", "EX", ttl])) === "OK";
  }
}

interface Entry {
  v: unknown;
  exp: number | null;
}

class MemoryStore implements Store {
  readonly kind: "memory" | "file" = "memory";
  protected map = new Map<string, Entry>();
  protected live(key: string): Entry | null {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) {
      this.map.delete(key);
      return null;
    }
    return e;
  }
  async get<T>(key: string) {
    const e = this.live(key);
    return e ? (structuredClone(e.v) as T) : null;
  }
  async set(key: string, value: unknown, ttl?: number) {
    this.map.set(key, { v: structuredClone(value), exp: ttl ? Date.now() + ttl * 1000 : null });
    this.persist(key);
  }
  async del(key: string) {
    this.map.delete(key);
    this.persist(key);
  }
  async incr(key: string, ttl: number) {
    const e = this.live(key);
    const n = (typeof e?.v === "number" ? e.v : 0) + 1;
    this.map.set(key, { v: n, exp: e?.exp ?? Date.now() + ttl * 1000 });
    this.persist(key);
    return n;
  }
  async setIfAbsent(key: string, value: unknown, ttl: number) {
    if (this.live(key)) return false;
    await this.set(key, value, ttl);
    return true;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected persist(_key: string) {}
}

/** One JSON file per key under .data/kv. Survives dev-server restarts. */
class FileStore extends MemoryStore {
  override readonly kind = "file" as const;
  constructor(private dir: string) {
    super();
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const e = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Entry & { k: string };
        this.map.set(e.k, { v: e.v, exp: e.exp });
      } catch {
        /* ignore corrupt entries */
      }
    }
  }
  private file(key: string) {
    return path.join(this.dir, `${Buffer.from(key).toString("base64url")}.json`);
  }
  /** Read through to disk, so a guide written by another process (npm run generate) shows up without a restart. */
  protected override live(key: string) {
    try {
      const e = JSON.parse(fs.readFileSync(this.file(key), "utf8")) as Entry & { k: string };
      this.map.set(key, { v: e.v, exp: e.exp });
    } catch {
      /* not on disk: memory only */
    }
    return super.live(key);
  }
  protected override persist(key: string) {
    const e = this.map.get(key);
    try {
      if (!e) fs.rmSync(this.file(key), { force: true });
      else fs.writeFileSync(this.file(key), JSON.stringify({ k: key, ...e }));
    } catch {
      /* best effort */
    }
  }
}

function createStore(): Store {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return new UpstashStore(url.replace(/\/$/, ""), token);
  if (!process.env.VERCEL) {
    try {
      const dir = path.join(process.cwd(), ".data", "kv");
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return new FileStore(dir);
    } catch {
      /* fall through to memory */
    }
  }
  return new MemoryStore();
}

const g = globalThis as unknown as { __oauthReadinessStore?: Store };
export function store(): Store {
  if (!g.__oauthReadinessStore) g.__oauthReadinessStore = createStore();
  return g.__oauthReadinessStore;
}
