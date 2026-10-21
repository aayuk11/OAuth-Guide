import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import { KeyButton } from "@/components/llm-settings";
import { HeaderSearch } from "@/components/search";
import { THEME_SCRIPT, ThemeToggle } from "@/components/theme";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")),
  title: { default: "OAuth Readiness", template: "%s · OAuth Readiness" },
  description: "Whether you need your own OAuth app for an integration, which approvals it needs, how long they take, and the exact setup steps. Every claim sourced and dated.",
  openGraph: { type: "website", siteName: "OAuth Readiness" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1013" },
  ],
};

const NAV = [
  { href: "/apps", label: "Guides" },
  { href: "/concepts", label: "Concepts" },
  { href: "/method", label: "Method" },
  { href: "/evidence", label: "Evidence" },
  { href: "/reference", label: "API" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-fg focus:px-3 focus:py-2 focus:text-bg">
          Skip to content
        </a>
        <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[90rem] items-center gap-4 px-4 lg:px-6">
            <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold text-fg no-underline">
              <span aria-hidden className="grid h-6 w-6 place-items-center rounded-md bg-fg text-[0.7rem] font-semibold text-bg">
                OR
              </span>
              <span className="hidden sm:inline">OAuth Readiness</span>
            </Link>
            <div className="min-w-0 flex-1 md:max-w-sm">
              <HeaderSearch />
            </div>
            <nav aria-label="Main" className="ml-auto hidden items-center gap-1 text-sm md:flex">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md px-2.5 py-1.5 text-fg-muted no-underline hover:bg-bg-muted hover:text-fg">
                  {n.label}
                </Link>
              ))}
            </nav>
            <KeyButton />
            <ThemeToggle />
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-fg-subtle lg:px-6">
            <span>Independent prototype built on Composio&apos;s public toolkit data. Not an official Composio product.</span>
            <span>Provider rules change. Every claim shows its source and the date it was read.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
