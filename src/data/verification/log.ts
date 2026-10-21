/**
 * Verification log: what the research pass corrected in the original plan, and what still needs
 * hands-on testing. Corrections cite the guide whose evidence supports them; the guide's sources
 * carry the URLs and verbatim excerpts.
 */

export interface Correction {
  guide: string;
  before: string;
  after: string;
  impact: "level" | "timeline" | "cost" | "setup" | "composio";
}

export const CORRECTIONS: Correction[] = [
  {
    guide: "composio",
    before: "Register https://backend.composio.dev/api/v1/auth-apps/add as the redirect URI (the toolkit data default).",
    after: "Composio's current docs use https://backend.composio.dev/api/v3/toolkits/auth/callback; v1 is a supported legacy endpoint. The provider and the auth config must match exactly.",
    impact: "setup",
  },
  {
    guide: "xero",
    before: "Uncertified Xero apps are capped at 25 connected organisations.",
    after: "Since 2 March 2026 the cap depends on a paid tier: 5 (Starter, free), 50 (Core), 1,000 (Plus, certified), 10,000 (Advanced, plus security assessment). New apps must use granular scopes.",
    impact: "cost",
  },
  {
    guide: "outlook",
    before: "Default tenant settings let users consent to apps from verified publishers for low-risk permissions.",
    after: "Tenants on Microsoft's managed consent policy block user consent for mail, calendar, contacts and chat scopes (rolled out late 2025). 9 of Composio's 12 default Outlook scopes need each customer's admin, verified publisher or not.",
    impact: "level",
  },
  {
    guide: "outlook",
    before: "Publisher verification completes in minutes once enrolled.",
    after: "The verification step is quick, but Partner Center account verification usually takes 3–5 business days first, and needs a registered business, business email and a verified domain.",
    impact: "timeline",
  },
  {
    guide: "linkedin",
    before: "The Community Management API is documented on LinkedIn's getting-access page and can be added to an existing app.",
    after: "It is documented under the Marketing docs, must be the only product on its app (a separate app and Composio auth config), and a rejected app needs a new app.",
    impact: "setup",
  },
  {
    guide: "linkedin",
    before: "LinkedIn's self-serve products have no ongoing friction.",
    after: "Self-serve access tokens last 60 days and refresh tokens go only to approved partners, so users must re-authorise about every 60 days.",
    impact: "setup",
  },
  {
    guide: "github",
    before: "GitHub OAuth app tokens do not expire, and OAuth apps allow one callback URL.",
    after: "New OAuth apps get 8-hour access tokens with refresh tokens by default (one GitHub page still says long-lived), and OAuth apps now allow up to 10 callback URLs.",
    impact: "setup",
  },
  {
    guide: "github",
    before: "Unknown whether Composio's GitHub toolkit works with GitHub App credentials.",
    after: "Composio's FAQ says it does, but the user must install the GitHub App separately and notifications endpoints do not accept GitHub App tokens.",
    impact: "composio",
  },
  {
    guide: "shopify",
    before: "Custom distribution is a way to serve several merchants without App Store review.",
    after: "Shopify's API terms limit a custom app to one merchant; cloning per merchant breaks the Partner Program Agreement. Serving many merchants means a public app and review.",
    impact: "level",
  },
  {
    guide: "shopify",
    before: "Composio's Shopify connection asks each user for their store subdomain; nothing to flag.",
    after: "Shopify App Store requirement 2.3.1 forbids asking merchants to type their shop domain, which conflicts with Composio's subdomain prompt for public apps.",
    impact: "composio",
  },
  {
    guide: "shopify",
    before: "App Store review takes weeks (no source).",
    after: "Shopify publishes no timeline; community reports range from about 2 weeks to about 2 months in 2026. Shown as Reported, 2–9 weeks.",
    impact: "timeline",
  },
  {
    guide: "gmail",
    before: "Google brand verification and scope verification run in parallel, so the wait is the longer of the two.",
    after: "Branding must be published before scope verification can be requested, so they run in sequence. The automated brand check now usually takes minutes; 2–3 business days applies to manual review.",
    impact: "timeline",
  },
  {
    guide: "gmail",
    before: "Some apps can use a free CASA Tier 2 self-scan.",
    after: "Google's help now names assurance levels (AL1/AL2), the App Defense Alliance lists only lab-tested routes, and a 2025 developer report says the free route ended. Shown as a conflict; reported lab fees $540–$6,300 a year.",
    impact: "cost",
  },
  {
    guide: "gmail",
    before: "Registering Composio's redirect URI is enough for verification.",
    after: "Google verification expects every redirect domain to be verified by you. backend.composio.dev cannot be, so production apps should route the callback through Composio's redirect proxy on their own domain.",
    impact: "composio",
  },
  {
    guide: "salesforce",
    before: "New Connected Apps are disabled by default since Spring '26, but an org setting re-enables them.",
    after: "Since Spring '26 there is no org setting; re-enabling Connected App creation needs a Salesforce Support request. External Client Apps are the path. Composio's own Salesforce setup guide still describes the old setting.",
    impact: "composio",
  },
  {
    guide: "salesforce",
    before: "An app created in your org works for your customers' orgs once they authorise it.",
    after: "Since September 2025 users cannot authorise uninstalled apps without a special permission, and a local External Client App fails across orgs. Customer orgs need a packaged ECA (managed 2GP) installed by their admin.",
    impact: "level",
  },
  {
    guide: "salesforce",
    before: "AppExchange security review: 4–5 weeks (Trailhead) vs 6–9 weeks (2023 blog).",
    after: "Three sources: Trailhead 4–5 weeks, the ISVforce Guide 1–2 weeks of checks then 3–4 weeks of testing, the 2023 blog 6–9 weeks. The listing (now AgentExchange) costs $999 per attempt for paid apps, nothing for free ones.",
    impact: "timeline",
  },
  {
    guide: "salesforce",
    before: "Composio's managed Salesforce app is fine for production agents.",
    after: "Salesforce's API Terms (July 2026) require ISV Partner Program enrolment for commercial use, and its agent integration protocols ask commercial developers to connect through an app they created.",
    impact: "composio",
  },
  {
    guide: "slack",
    before: "Unlisted (public distribution) Slack apps are a fine way to launch: no review, full API.",
    after: "Unlisted commercial apps read message history at 1 request per minute (15 messages per call), cannot use the Real-time Search API or Slack's MCP server, and Slack's API terms (Oct 2025) reserve commercial distribution for Marketplace apps.",
    impact: "level",
  },
  {
    guide: "slack",
    before: "The Marketplace needs 10 active workspaces (or 5, per one 2025 change).",
    after: "The minimum dropped to 5 in August 2025 and is back at 10 as of July 2026; sandbox workspaces do not count. Composio's default search:read scope is not accepted on the Marketplace.",
    impact: "timeline",
  },
  {
    guide: "slack",
    before: "Composio's verification_token field is what Slack needs for triggers.",
    after: "Slack marks verification tokens as deprecated in favour of the signing secret; Composio's newer webhook setup uses the signing secret.",
    impact: "composio",
  },
];

export interface HandsOn {
  guide: string;
  check: string;
  needs: string;
  status: "todo" | "done";
}

/** Checks that need the developer's own free accounts. Until done, the claims stay Official, not Tested. */
export const HANDS_ON: HandsOn[] = [
  { guide: "gmail", check: "Create an External app in Testing, request gmail.readonly, confirm it is listed as restricted and the 100-test-user limit.", needs: "Google Cloud account", status: "todo" },
  { guide: "slack", check: "Create an app from a manifest, activate public distribution, confirm no review step.", needs: "Free Slack workspace", status: "todo" },
  { guide: "github", check: "Create an OAuth app with Composio's callback, confirm no review, wire it into a Composio custom auth config end to end.", needs: "GitHub account + Composio account", status: "todo" },
  { guide: "salesforce", check: "In a Developer Edition org, confirm New Connected App is off by default and External Client App is offered.", needs: "Salesforce Developer Edition org", status: "todo" },
  { guide: "shopify", check: "Confirm the distribution method is locked after choosing it in the Dev Dashboard.", needs: "Shopify Partner or store account", status: "todo" },
  { guide: "linkedin", check: "Confirm which products are self-serve on a new app linked to a Page.", needs: "LinkedIn account with a Company Page", status: "todo" },
];
