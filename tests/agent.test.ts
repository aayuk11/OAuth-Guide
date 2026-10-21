import { beforeAll, describe, expect, it } from "vitest";
import { matchExcerpt } from "@/lib/text/match";
import { htmlToText } from "@/lib/text/html";
import { checkUrl, isPrivateAddress } from "@/lib/net/safe-fetch";
import { assembleGuide } from "@/lib/agent/assemble";
import { runCritic, isCommunityUrl } from "@/lib/agent/critic";
import { mockDraft, mockResearch } from "@/lib/agent/mock";
import { checkRedirectUri } from "@/lib/agent/probes";
import { GuideSchema, crossCheckGuide } from "@/lib/guide/schema";
import { getToolkit } from "@/lib/catalog";

beforeAll(async () => {
  // Force the in-memory store and the mock model for pipeline tests.
  process.env.VERCEL = "1";
  process.env.AGENT_MOCK = "1";
  // Load the pipeline (and the three provider SDKs) once here, outside any single test's time limit.
  await import("@/lib/agent/pipeline");
}, 120_000);

describe("excerpt matching", () => {
  const page = htmlToText("<p>Apps must be <b>reviewed</b> before they can be installed by other organisations.</p><p>Review takes 5&ndash;10 business days.</p>");
  it("matches verbatim text across markup", () => {
    expect(matchExcerpt("Apps must be reviewed before they can be installed", page).match).toBe(true);
    expect(matchExcerpt("Review takes 5–10 business days.", page).match).toBe(true);
  });
  it("rejects text that is not on the page", () => {
    expect(matchExcerpt("A security questionnaire is mandatory for all apps.", page).match).toBe(false);
    expect(matchExcerpt("10 days", page).match).toBe(false);
  });
});

describe("SSRF guard", () => {
  it("flags private addresses", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "192.0.66.2"]) expect(isPrivateAddress(ip)).toBe(false);
    for (const ip of ["192.0.2.10", "198.51.100.1", "203.0.113.5", "100.64.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
  });
  it("rejects unsafe URLs", () => {
    for (const u of ["file:///etc/passwd", "http://localhost/", "https://user:pw@example.com", "https://example.com:8443/", "https://10.0.0.1/", "https://intranet/"])
      expect(() => checkUrl(u)).toThrow();
    expect(checkUrl("https://developer.example.com/docs").hostname).toBe("developer.example.com");
  });
});

describe("structured-output schema", () => {
  it("keeps enums and stays within the API's limits", async () => {
    const { toStructuredOutputSchema, schemaStats } = await import("@/lib/agent/json-schema");
    const { DraftSchema } = await import("@/lib/agent/draft-schema");
    const stats = schemaStats(toStructuredOutputSchema(DraftSchema));
    expect(stats.enums).toBeGreaterThanOrEqual(16);
    expect(stats.optional).toBe(0); // limit 24
    expect(stats.unions).toBe(0); // limit 16
  });
  it("accepts the mock draft", async () => {
    const { DraftSchema } = await import("@/lib/agent/draft-schema");
    expect(DraftSchema.safeParse(await mockDraft("Acme")).success).toBe(true);
  });
});

describe("redirect URI check", () => {
  it("accepts Composio's URI and rejects bad ones", () => {
    expect(checkRedirectUri("https://backend.composio.dev/api/v1/auth-apps/add").ok).toBe(true);
    expect(checkRedirectUri("http://example.com/cb").ok).toBe(false);
    expect(checkRedirectUri("https://example.com/cb#x").ok).toBe(false);
    expect(checkRedirectUri("http://localhost:3000/cb").ok).toBe(true);
  });
});

describe("assemble + critic", () => {
  it("builds a valid guide and catches unsupported claims", async () => {
    const research = await mockResearch("Acme", () => {});
    const draft = await mockDraft("Acme");
    const guide = assembleGuide(draft, { key: "acme", query: "Acme", toolkit: null, sources: research.sources, probeEvidence: [], dcrFound: false, runId: "r1", model: "mock" });
    expect(GuideSchema.safeParse(guide).success).toBe(true);
    expect(crossCheckGuide(guide)).toEqual([]);

    const { guide: checked, stats } = runCritic(guide, research.sources);
    const byId = new Map(checked.evidence.map((e) => [e.id, e]));
    expect(byId.get("e1")!.label).toBe("official"); // quote is on the page
    expect(byId.get("e2")!.label).toBe("reported"); // forum relabelled
    expect(byId.get("e3")!.label).toBe("unverified"); // quote not on the page
    expect(byId.get("e3")!.corrected?.from).toBe("official");
    const security = checked.paths.find((p) => p.id === "public")!.gates.find((g) => g.type === "security_assessment")!;
    expect(security.wait).toBeNull(); // timeline removed: only unverified evidence
    expect(stats.numbers_removed).toBe(1);
    expect(stats.downgraded).toBe(2);
    expect(security.after).toBe("g1");
  });
  it("recognises community sites", () => {
    expect(isCommunityUrl("https://devforum.zoom.us/t/x/1")).toBe(true);
    expect(isCommunityUrl("https://www.reddit.com/r/x")).toBe(true);
    expect(isCommunityUrl("https://developers.google.com/identity")).toBe(false);
  });
});

describe("pipeline (mock model, memory store)", () => {
  it("runs end to end and saves a guide", async () => {
    const { createRun, getGeneratedGuide, getRun } = await import("@/lib/agent/runs");
    const { runPipeline } = await import("@/lib/agent/pipeline");
    const run = await createRun("Shopify", "shopify");
    const guide = await runPipeline(run, { query: "Shopify", toolkitSlug: "shopify", creds: null });
    await run.flush();
    expect(guide).not.toBeNull();
    expect(guide!.composio_slug).toBe("shopify");
    expect(guide!.meta?.critic?.downgraded).toBe(2);
    const saved = await getGeneratedGuide("shopify");
    expect(saved?.slug).toBe("shopify");
    const rec = await getRun(run.record.id);
    expect(rec?.status).toBe("done");
    const types = rec!.events.map((e) => e.type);
    expect(types[0]).toBe("run");
    expect(types).toContain("search");
    expect(types).toContain("read");
    expect(types.at(-1)).toBe("done");
    expect(getToolkit("shopify")).not.toBeNull();
  });
});
