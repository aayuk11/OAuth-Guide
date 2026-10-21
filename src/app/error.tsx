"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-[48rem] px-4 py-16">
      <h1 className="text-[1.9rem] font-semibold tracking-[-0.015em] text-fg">Something went wrong</h1>
      <p className="mt-3 text-fg-muted">The page failed to load. Saved guides are unaffected.</p>
      <div className="mt-6 flex gap-2">
        <button type="button" onClick={reset} className="rounded-md bg-fg px-3 py-1.5 text-sm font-medium text-bg">
          Try again
        </button>
        <Link href="/" className="rounded-md border border-border px-3 py-1.5 text-sm text-fg no-underline">
          Overview
        </Link>
      </div>
    </div>
  );
}
