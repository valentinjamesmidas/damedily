"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Check, Cog, Menu, X } from "lucide-react";
import { TrustPillars } from "@/components/trust-pillars";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Úvod" },
  { href: "/#akcni", label: "Akční nabídka" },
  { href: "/#stala", label: "Stálá nabídka" },
  { href: "/#pneu", label: "Pneu pro dodávky" },
  { href: "/ucet", label: "Můj účet" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="bg-primary text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="flex items-center gap-3" onClick={() => setOpen(false)}>
          <span className="relative inline-flex h-10 w-10 items-center justify-center" aria-hidden>
            <Cog className="h-10 w-10" strokeWidth={1.5} />
            <Check className="absolute h-4 w-4 text-accent" strokeWidth={3.5} />
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">
            DámeDíly<span className="text-accent">.cz</span>
          </span>
        </Link>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 md:hidden"
          aria-expanded={open}
          aria-controls="hlavni-menu"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          <span className="sr-only">{open ? "Zavřít menu" : "Otevřít menu"}</span>
        </button>
        <nav aria-label="Hlavní" className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <NavLink key={link.href} href={link.href} pathname={pathname} />
          ))}
        </nav>
      </div>
      {open ? (
        <nav id="hlavni-menu" aria-label="Hlavní mobilní" className="space-y-1 px-4 pb-4 md:hidden">
          {links.map((link) => (
            <NavLink key={link.href} href={link.href} pathname={pathname} onClick={() => setOpen(false)} />
          ))}
        </nav>
      ) : null}
      <TrustPillars />
    </header>
  );
}

function NavLink({ href, pathname, onClick }: { href: string; pathname: string; onClick?: () => void }) {
  const label = links.find((link) => link.href === href)?.label ?? href;
  const active = pathname === href;
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "block rounded-full px-4 py-2 text-sm font-semibold",
        active ? "bg-white/10" : "text-white/80 hover:text-white",
      )}
    >
      {label}
    </Link>
  );
}
