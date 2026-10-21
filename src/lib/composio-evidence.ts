import type { Evidence } from "@/lib/guide/schema";
import { catalogSnapshot, snapshotDate, type Toolkit } from "@/lib/catalog";

/**
 * Evidence for Composio-side claims (verdict reasons, wiring steps). Excerpts are verbatim
 * from Composio's docs, read on 2026-10-20, and re-checkable with the same matcher.
 */
const READ = "2026-10-20";
const MVC = "https://docs.composio.dev/docs/authentication/custom-app-vs-managed-app";
const MANAGED = "https://docs.composio.dev/toolkits/managed-auth";
const WL = "https://docs.composio.dev/docs/authentication/white-labeling-authentication";

export const COMPOSIO_EVIDENCE: Evidence[] = [
  {
    id: "cx-branding",
    label: "official",
    url: MVC,
    title: "Managed vs custom auth",
    publisher: "Composio",
    retrieved: READ,
    excerpt: "Your users see OAuth consent screens. In production, users should see your app name, not \"Composio.\" This is the most common reason to switch.",
  },
  {
    id: "cx-consent-text",
    label: "official",
    url: MVC,
    title: "Managed vs custom auth",
    publisher: "Composio",
    retrieved: READ,
    excerpt: "Users will see \"Composio wants to access your account\" during OAuth.",
  },
  {
    id: "cx-scopes",
    label: "official",
    url: MVC,
    title: "Managed vs custom auth",
    publisher: "Composio",
    retrieved: READ,
    excerpt: "You need custom scopes. Composio's default scopes may not include everything you need",
  },
  {
    id: "cx-quota",
    label: "official",
    url: MVC,
    title: "Managed vs custom auth",
    publisher: "Composio",
    retrieved: READ,
    excerpt: "Managed apps share quota across all Composio users. Your own app gets a dedicated quota.",
  },
  {
    id: "cx-polling",
    label: "official",
    url: MVC,
    title: "Managed vs custom auth",
    publisher: "Composio",
    retrieved: READ,
    excerpt: "Managed auth enforces a 15-minute minimum polling interval; your own app can use shorter polling intervals where supported.",
  },
  {
    id: "cx-instance",
    label: "official",
    url: MVC,
    title: "Managed vs custom auth",
    publisher: "Composio",
    retrieved: READ,
    excerpt: "Self-hosted or regional variants (e.g., a private Salesforce subdomain) need their own OAuth app.",
  },
  {
    id: "cx-byo-required",
    label: "official",
    url: MANAGED,
    title: "Managed OAuth apps",
    publisher: "Composio",
    retrieved: READ,
    excerpt: "Register your own OAuth app when a toolkit does not have managed OAuth. Then create a custom auth config with the app's client ID and client secret.",
  },
  {
    id: "cx-redirect",
    label: "official",
    url: MVC,
    title: "Managed vs custom auth",
    publisher: "Composio",
    retrieved: READ,
    excerpt: "For OAuth toolkits, the dashboard shows the redirect URI to add in the provider's developer portal.",
  },
  {
    id: "cx-redirect-v3",
    label: "official",
    url: "https://docs.composio.dev/docs/authentication/programmatic-auth-configs",
    title: "Programmatic auth configs",
    publisher: "Composio",
    retrieved: READ,
    excerpt:
      "Set oauth_redirect_uri to the exact URL registered in your provider's OAuth app. Some toolkit defaults still use the supported legacy endpoint https://backend.composio.dev/api/v1/auth-apps/add .",
    note: "The same page shows https://backend.composio.dev/api/v3/toolkits/auth/callback as Composio's callback.",
  },
  {
    id: "cx-session",
    label: "official",
    url: MVC,
    title: "Managed vs custom auth",
    publisher: "Composio",
    retrieved: READ,
    excerpt: "Creating the auth config isn't enough on its own. A session uses your config only when you pass its ID to authConfigs , keyed by toolkit.",
  },
  {
    id: "cx-reconnect",
    label: "official",
    url: WL,
    title: "White-labeling authentication",
    publisher: "Composio",
    retrieved: READ,
    excerpt:
      "Switching to a custom auth config affects new connections for that toolkit; existing users keep using their current connected accounts until they re-authenticate or you import/migrate their credentials.",
  },
  {
    id: "cx-proxy",
    label: "official",
    url: WL,
    title: "White-labeling authentication",
    publisher: "Composio",
    retrieved: READ,
    excerpt: "During OAuth, the browser briefly redirects through backend.composio.dev so Composio can capture the auth token.",
  },
];

const byId = new Map(COMPOSIO_EVIDENCE.map((e) => [e.id, e]));
export function composioEvidence(id: string): Evidence | undefined {
  return byId.get(id);
}

/** Evidence item describing what Composio's toolkit data says about one toolkit. */
export function toolkitDataEvidence(t: Toolkit): Evidence {
  const snap = catalogSnapshot();
  const auth = t.auth.join(", ") || "none";
  const managed = t.managed.join(", ") || "none";
  return {
    id: "cx-data",
    label: "official",
    url: snap.source,
    title: `Composio toolkit data: ${t.name}`,
    publisher: "Composio",
    retrieved: snapshotDate(),
    excerpt: `authSchemes: [${auth}]; composioManagedAuthSchemes: [${managed}]`,
    note: `From Composio's public toolkits.json (toolkit version ${snap.latest_toolkit_version}). Default scopes and connection fields come from the same record.`,
  };
}
