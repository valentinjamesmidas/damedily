"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const fieldClass = "mt-1 w-full rounded-2xl border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";

export function LoginForm({ configured, nextPath }: { configured: boolean; nextPath: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    const supabase = createBrowserSupabase();
    if (!supabase) {
      setMessage("Přihlášení není nastavené. Doplňte veřejnou adresu Supabase a anon klíč.");
      return;
    }
    setPending(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setPending(false);
    if (error) {
      setMessage("Přihlášení se nepodařilo. Zkontrolujte e-mail a heslo.");
      return;
    }
    router.replace(nextPath);
    router.refresh();
  }

  async function sendLink() {
    const supabase = createBrowserSupabase();
    if (!supabase) {
      setMessage("Přihlášení není nastavené. Doplňte veřejnou adresu Supabase a anon klíč.");
      return;
    }
    setPending(true);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    setPending(false);
    if (error) {
      setMessage("Odkaz se nepodařilo poslat. Účet musí už existovat.");
      return;
    }
    setMessage("Pokud k tomuto e-mailu účet existuje, odešel přihlašovací odkaz.");
  }

  return (
    <div className="max-w-md">
      <p className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-accent">Administrace</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">Přihlášení do administrace</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        E-mail a heslo, nebo jednorázový odkaz. Nový účet se tady nezakládá a role admin se sama nepřiřadí.
      </p>
      {!configured ? (
        <p role="alert" className="mt-4 rounded-2xl bg-accent/15 px-4 py-3 text-sm leading-6">
          Chybí NEXT_PUBLIC_SUPABASE_URL nebo NEXT_PUBLIC_SUPABASE_ANON_KEY. Bez nich vás sem nepustíme a sklad se
          nenačte.
        </p>
      ) : null}
      <form onSubmit={signIn} className="mt-6 space-y-4">
        <label className="block text-sm font-semibold">
          E-mail
          <input className={fieldClass} type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="block text-sm font-semibold">
          Heslo
          <input className={fieldClass} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {message ? <p className="text-sm leading-6">{message}</p> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="accent" disabled={pending || !configured}>
            Přihlásit se
          </Button>
          <Button type="button" variant="outline" disabled={pending || !configured || !email.trim()} onClick={() => void sendLink()}>
            Poslat přihlašovací odkaz
          </Button>
        </div>
      </form>
    </div>
  );
}
