import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted">
        <p>DámeDíly.cz</p>
        <Link href="/admin" className="font-semibold text-primary hover:text-accent">
          Administrace
        </Link>
      </div>
    </footer>
  );
}
