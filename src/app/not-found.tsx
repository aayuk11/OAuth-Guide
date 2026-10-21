import Link from "next/link";
import { DocsShell, PageHeader } from "@/components/docs";
import { SearchBox } from "@/components/search";

export default function NotFound() {
  return (
    <DocsShell>
      <PageHeader title="Page not found" lead="There is no guide at this address. Search for the app instead; anything not in the library can be researched live." />
      <SearchBox />
      <p className="mt-4 text-sm">
        <Link href="/apps" className="link">
          Browse all toolkits
        </Link>
      </p>
    </DocsShell>
  );
}
