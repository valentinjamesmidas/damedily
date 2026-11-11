import type { ReactNode } from "react";
import Link from "next/link";

export function AdminAccess({
  status,
  children,
}: {
  status: "admin" | "customer" | "anonymous";
  children?: ReactNode;
}) {
  if (status === "admin") return <>{children}</>;

  if (status === "customer") {
    return (
      <section className="max-w-xl rounded-3xl border border-line bg-card p-6">
        <h1 className="font-display text-3xl font-semibold">Přístup odepřen</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Administrace je jen pro roli admin. Zákaznický účet sklad, nákupní cenu ani interní tag nevidí.
        </p>
        <Link href="/" className="mt-5 inline-block text-sm font-semibold text-accent">
          Zpět na úvod
        </Link>
      </section>
    );
  }

  return (
    <section className="max-w-xl rounded-3xl border border-line bg-card p-6">
      <h1 className="font-display text-3xl font-semibold">Přihlaste se</h1>
      <p className="mt-3 text-sm leading-6 text-muted">Bez přihlášení administrátora sem nesmíte.</p>
      <Link href="/admin/prihlaseni" className="mt-5 inline-block text-sm font-semibold text-accent">
        Přihlášení do administrace
      </Link>
    </section>
  );
}
