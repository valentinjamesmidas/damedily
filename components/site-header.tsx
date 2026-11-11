"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Cog } from "lucide-react";
import { TrustPillars } from "@/components/trust-pillars";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Úvod" },
  { href: "/ucet", label: "Můj účet" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="bg-primary text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-4">
        <Link href="/" className="flex items-center gap-3">
          <span className="relative inline-flex h-10 w-10 items-center justify-center" aria-hidden>
            <Cog className="h-10 w-10" strokeWidth={1.5} />
            <Check className="absolute h-4 w-4 text-accent" strokeWidth={3.5} />
          </span>
          <span className="font-display text-xl font-semibold tracking-tight">
            DámeDíly<span className="text-accent">.cz</span>
          </span>
        </Link>
        <nav aria-label="Hlavní" className="flex items-center gap-1">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-semibold",
                  active ? "bg-white/10" : "text-white/80 hover:text-white",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <TrustPillars />
    </header>
  );
}
