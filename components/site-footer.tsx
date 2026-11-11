import Link from "next/link";

const links = [
  { href: "/obchodni-podminky", label: "Obchodní podmínky" },
  { href: "/reklamace", label: "Reklamace" },
  { href: "/odstoupeni", label: "Odstoupení do 14 dnů" },
  { href: "/admin", label: "Administrace" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>DámeDíly.cz je prodávající. Údaje firmy doplní obchodní podmínky.</p>
        <nav aria-label="Právní" className="flex flex-wrap gap-x-4 gap-y-2">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="font-semibold text-primary hover:text-accent">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
