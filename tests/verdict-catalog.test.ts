import { describe, expect, it } from "vitest";
import { catalogStats, getToolkit, resolveToolkit, toolkitKind } from "@/lib/catalog";
import { computeVerdict } from "@/lib/guide/verdict";
import { guide, path, ev } from "./fixtures";

const ext = { audience: "external" as const, access: "read" as const, brand: true };

describe("catalogue", () => {
  it("matches the counts in Composio's data", () => {
    const s = catalogStats();
    expect(s.oauth2).toBe(221);
    expect(s.managed).toBe(122);
    expect(s.byo).toBe(99);
    expect(s.dcr).toBe(99);
  });
  it("resolves names, aliases and ambiguity", () => {
    expect(resolveToolkit("Gmail")).toMatchObject({ kind: "toolkit", toolkit: { slug: "gmail" } });
    expect(resolveToolkit("Teams")).toMatchObject({ kind: "toolkit", toolkit: { slug: "microsoft_teams" } });
    expect(resolveToolkit("X")).toMatchObject({ kind: "toolkit", toolkit: { slug: "twitter" } });
    expect(resolveToolkit("https://www.shopify.com/pricing")).toMatchObject({ kind: "toolkit", toolkit: { slug: "shopify" } });
    expect(resolveToolkit("https://www.getjobber.com")).toMatchObject({ kind: "toolkit", toolkit: { slug: "jobber" } });
    expect(resolveToolkit("notion.so")).toMatchObject({ kind: "toolkit", toolkit: { slug: "notion" } });
    const meta = resolveToolkit("Meta");
    expect(meta.kind).toBe("candidates");
    if (meta.kind === "candidates") expect(meta.candidates.map((c) => c.slug)).toContain("instagram");
    expect(resolveToolkit("Google").kind).toBe("candidates");
    expect(resolveToolkit("asdfqwer").kind).toBe("none");
  });
  it("classifies toolkits", () => {
    expect(toolkitKind(getToolkit("gmail")!)).toBe("managed");
    expect(toolkitKind(getToolkit("shopify")!)).toBe("byo");
    expect(toolkitKind(getToolkit("notion_mcp")!)).toBe("dcr");
    expect(toolkitKind(getToolkit("openai")!)).toBe("no_oauth");
  });
});

describe("verdict", () => {
  it("managed + brand → start managed, own app before launch", () => {
    const v = computeVerdict({ toolkit: getToolkit("gmail"), guide: null, intake: ext, appName: "Gmail" });
    expect(v.type).toBe("managed_now_byo_later");
    expect(v.gatesMatterNow).toBe(true);
  });
  it("managed + own org + no brand → managed works", () => {
    const v = computeVerdict({ toolkit: getToolkit("gmail"), guide: null, intake: { audience: "own_org", access: "read", brand: false }, appName: "Gmail" });
    expect(v.type).toBe("managed_ok");
  });
  it("no managed app → bring your own", () => {
    expect(computeVerdict({ toolkit: getToolkit("shopify"), guide: null, intake: ext, appName: "Shopify" }).type).toBe("byo_required");
  });
  it("API key only → no OAuth app", () => {
    expect(computeVerdict({ toolkit: getToolkit("openai"), guide: null, intake: ext, appName: "OpenAI" }).type).toBe("no_oauth");
  });
  it("DCR → no registration", () => {
    expect(computeVerdict({ toolkit: getToolkit("notion_mcp"), guide: null, intake: ext, appName: "Notion MCP" }).type).toBe("no_registration");
  });
  it("not in catalogue + OAuth → bring your own; unknown otherwise", () => {
    const g = guide([path("p", [])], [ev("e1", "official")]);
    expect(computeVerdict({ toolkit: null, guide: g, intake: ext, appName: "Acme" }).type).toBe("byo_required");
    const u = guide([path("p", [])], [ev("e1", "official")], { oauth: { supported: "unknown", registration: "unknown", notes: [], evidence: [] } });
    expect(computeVerdict({ toolkit: null, guide: u, intake: ext, appName: "Acme" }).type).toBe("unknown");
  });
});
