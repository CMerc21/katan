"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";
import { useSession } from "@/hooks/useSession";
import { saveDisplayName, sendMagicLink, verifyEmailCode } from "@/lib/supabase";

/** Magic-link / email-code sign in (docs/phase4.md §6). */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const { session, loading, configured } = useSession();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) {
      void (async () => {
        if (name.trim()) await saveDisplayName(name);
        router.replace(next.startsWith("/") ? next : "/");
      })();
    }
  }, [session, loading, router, next, name]);

  if (!configured) {
    return (
      <main className="parchment mx-auto my-8 max-w-md rounded-lg px-6 py-8">
        <h1 className="text-2xl font-semibold">Online play is not configured</h1>
        <p className="mt-2 text-ink-soft">Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or play hotseat on this device.</p>
        <Button className="mt-6" onClick={() => router.push("/hotseat")}>
          Play hotseat
        </Button>
      </main>
    );
  }

  const send = async () => {
    setBusy(true);
    setProblem(null);
    const result = await sendMagicLink(email.trim(), next);
    setBusy(false);
    if (!result.ok) return setProblem(result.message);
    setSent(true);
  };

  const verify = async () => {
    setBusy(true);
    setProblem(null);
    const result = await verifyEmailCode(email.trim(), code.trim());
    setBusy(false);
    if (!result.ok) setProblem(result.message);
  };

  return (
    <main className="parchment mx-auto my-8 max-w-md rounded-lg px-6 py-8">
      <h1 className="font-display text-4xl font-semibold">Sign in</h1>
      <p className="mt-1 text-ink-soft">We email you a link and a code. No password.</p>
      {!sent ? (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="block text-sm">
            Email
            <input type="email" required autoComplete="email" className="mt-1 w-full rounded-md border border-line bg-white/60 px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="email" />
          </label>
          <label className="block text-sm">
            Display name <span className="text-ink-soft">(optional)</span>
            <input className="mt-1 w-full rounded-md border border-line bg-white/60 px-3 py-2" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} data-testid="display-name" />
          </label>
          {problem && (
            <p className="text-sm text-clay" role="alert">
              {problem}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy || !email.includes("@")} reason="Enter your email" data-testid="send-link">
            Send me a link
          </Button>
        </form>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <p className="text-sm">
            Check <strong>{email}</strong>. Click the link, or type the 6-digit code from the email here.
          </p>
          <label className="block text-sm">
            Code
            <input inputMode="numeric" autoComplete="one-time-code" className="mt-1 w-40 rounded-md border border-line bg-white/60 px-3 py-2 font-mono text-lg tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} data-testid="otp" />
          </label>
          {problem && (
            <p className="text-sm text-clay" role="alert">
              {problem}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={busy || code.trim().length < 6} reason="Enter the 6-digit code" data-testid="verify">
              Sign in
            </Button>
            <Button variant="quiet" onClick={() => setSent(false)}>
              Use a different email
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
