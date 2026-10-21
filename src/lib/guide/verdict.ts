import { hasOAuth, isManagedOAuth, type Toolkit } from "@/lib/catalog";
import type { Guide } from "./schema";
import type { Intake } from "./intake";

/** The headline answer to "Do I need my own OAuth app?", computed in code, never by the model. */

export type VerdictType = "no_oauth" | "no_registration" | "managed_ok" | "managed_now_byo_later" | "byo_required" | "unknown";

export interface VerdictReason {
  text: string;
  evidence?: string[];
}

export interface Verdict {
  type: VerdictType;
  title: string;
  summary: string;
  reasons: VerdictReason[];
  /** Whether the provider's approval gates matter right now. */
  gatesMatterNow: boolean;
}

export const VERDICT_SHORT: Record<VerdictType, string> = {
  no_oauth: "No OAuth app needed",
  no_registration: "No app registration needed",
  managed_ok: "Composio's managed app works",
  managed_now_byo_later: "Managed now, your own app before launch",
  byo_required: "Bring your own OAuth app",
  unknown: "Not yet known",
};

export function computeVerdict(args: { toolkit: Toolkit | null; guide: Guide | null; intake: Intake; appName: string }): Verdict {
  const { toolkit, guide, intake, appName } = args;
  const reasons: VerdictReason[] = [];

  // 1. Does the app use OAuth at all (for Composio)?
  if (toolkit && !hasOAuth(toolkit) && !toolkit.dcr) {
    const schemes = toolkit.auth.map((a) => a.replace(/_/g, " ").toLowerCase()).join(", ") || "no auth";
    return {
      type: "no_oauth",
      title: `No OAuth app needed for ${appName}`,
      summary: `Composio connects ${appName} with ${schemes}, so there is no provider OAuth app to register or get approved. Each user supplies their own credential when they connect.`,
      reasons: [
        { text: `Composio's toolkit for ${appName} uses ${schemes}, not OAuth.`, evidence: ["cx-data"] },
        ...(guide?.oauth.supported === "yes"
          ? [{ text: `${appName} does offer OAuth, but Composio's toolkit does not use it today.`, evidence: guide.oauth.evidence }]
          : []),
      ],
      gatesMatterNow: false,
    };
  }
  if (!toolkit && guide?.oauth.supported === "no") {
    return {
      type: "no_oauth",
      title: `${appName} does not appear to offer OAuth`,
      summary: `The research found no OAuth authorization flow for ${appName}. Integrations typically use API keys or other credentials, so there is no OAuth app to get approved.`,
      reasons: [{ text: "No OAuth flow found in the provider's documentation.", evidence: guide.oauth.evidence }],
      gatesMatterNow: false,
    };
  }

  // 2. Self-registration (Dynamic Client Registration / Client ID Metadata Documents).
  const dcrOnly = toolkit ? !hasOAuth(toolkit) && !!toolkit.dcr : false;
  const guideDcr = guide?.oauth.registration === "dcr" || guide?.oauth.registration === "cimd";
  if (dcrOnly || (!toolkit && guideDcr)) {
    return {
      type: "no_registration",
      title: "No app registration needed",
      summary: `${appName}'s MCP server lets clients register themselves (Dynamic Client Registration), so Composio can connect users without you creating an OAuth app. Your users still approve access on ${appName}'s consent screen.`,
      reasons: [
        dcrOnly
          ? { text: `Composio's ${toolkit!.name} toolkit authenticates with dynamic client registration (DCR_OAUTH).`, evidence: ["cx-data"] }
          : { text: "The provider's authorization server advertises a registration endpoint.", evidence: guide!.oauth.evidence },
      ],
      gatesMatterNow: false,
    };
  }

  // 3. Not in Composio's catalogue.
  if (!toolkit) {
    return {
      type: guide?.oauth.supported === "yes" ? "byo_required" : "unknown",
      title: guide?.oauth.supported === "yes" ? "Bring your own OAuth app" : "Not yet known",
      summary:
        guide?.oauth.supported === "yes"
          ? `${appName} is not in Composio's toolkit catalogue, so there is no managed app. To connect users by OAuth you need your own OAuth app with ${appName}, wired into a custom integration.`
          : `${appName} is not in Composio's toolkit catalogue and the research could not confirm how it authenticates.`,
      reasons: [{ text: `${appName} is not in Composio's catalogue snapshot.`, evidence: [] }],
      gatesMatterNow: guide?.oauth.supported === "yes",
    };
  }

  // 4. In the catalogue, OAuth.
  if (!isManagedOAuth(toolkit)) {
    reasons.push({ text: `Composio has no managed OAuth app for ${appName}.`, evidence: ["cx-data", "cx-byo-required"] });
    if (toolkit.auth.includes("API_KEY"))
      reasons.push({ text: "An API key also works, but only for one account at a time: fine for testing, not for your users.", evidence: ["cx-data"] });
    return {
      type: "byo_required",
      title: "Bring your own OAuth app now",
      summary: `There is no Composio-managed OAuth app for ${appName}. To let your users connect, register an OAuth app with the provider and add its credentials to a custom auth config.`,
      reasons,
      gatesMatterNow: true,
    };
  }

  if (intake.brand) {
    return {
      type: "managed_now_byo_later",
      title: "Start on Composio's app now; your own app before launch",
      summary: `Composio's managed ${appName} app works today, but its consent screen says "Composio". Build and test on it now, and start your own app's approval in parallel so it is ready for launch.`,
      reasons: [
        { text: "You want your app's name on the consent screen. Composio's managed app shows Composio.", evidence: ["cx-branding", "cx-consent-text"] },
        { text: "Your own app also gets its own rate-limit quota instead of a shared one.", evidence: ["cx-quota"] },
        { text: "Switching later affects new connections only; existing users must reconnect.", evidence: ["cx-reconnect"] },
      ],
      gatesMatterNow: true,
    };
  }

  const caveats: VerdictReason[] = [
    { text: "Users will see \"Composio\" on the consent screen.", evidence: ["cx-consent-text"] },
    { text: "Managed apps share rate-limit quota across all Composio users.", evidence: ["cx-quota"] },
    { text: "Polling triggers run at most every 15 minutes on managed auth.", evidence: ["cx-polling"] },
    { text: "You can only use Composio's default scopes.", evidence: ["cx-scopes"] },
  ];
  return {
    type: "managed_ok",
    title: "Composio's managed app works for this",
    summary:
      intake.audience === "own_org"
        ? `For your own organisation, Composio's managed ${appName} app is enough. You do not need your own OAuth app unless one of the limits below matters to you.`
        : `You can launch on Composio's managed ${appName} app if its trade-offs are acceptable. The approval path below is what your own app would take if you need it later.`,
    reasons: caveats,
    gatesMatterNow: false,
  };
}
