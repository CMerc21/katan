"use client";

/**
 * Browser Supabase client and auth helpers (docs/phase4.md §6). Only the
 * anon key ever reaches the browser; Row Level Security does the rest.
 */

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  }
  return client;
}

export async function currentSession(): Promise<Session | null> {
  const { data } = await supabase().auth.getSession();
  return data.session;
}

/** Send a magic link; `next` is where the user lands after clicking it. */
export async function sendMagicLink(email: string, next: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const redirect = `${window.location.origin}/login?next=${encodeURIComponent(next)}`;
  const { error } = await supabase().auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function verifyEmailCode(email: string, token: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase().auth.verifyOtp({ email, token, type: "email" });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
}

export function displayNameOf(session: Session | null): string {
  const meta = session?.user.user_metadata as { display_name?: string } | undefined;
  return meta?.display_name ?? session?.user.email?.split("@")[0] ?? "Player";
}

/** Store the display name in auth.users.raw_user_meta_data (docs/phase4.md §6). */
export async function saveDisplayName(name: string): Promise<void> {
  await supabase().auth.updateUser({ data: { display_name: name.trim().slice(0, 20) } });
}

/** Call an Edge Function and unwrap the { ok, code, message } envelope. */
export async function callFunction<T extends Record<string, unknown>>(
  name: string,
  body: Record<string, unknown>,
): Promise<({ ok: true } & T) | { ok: false; code: string; message: string }> {
  const { data, error } = await supabase().functions.invoke(name, { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const parsed = (await ctx.json().catch(() => null)) as { ok?: boolean; code?: string; message?: string } | null;
      if (parsed && parsed.ok === false) return { ok: false, code: parsed.code ?? "BAD_REQUEST", message: parsed.message ?? "" };
    }
    return { ok: false, code: "NETWORK", message: error.message };
  }
  return data as ({ ok: true } & T) | { ok: false; code: string; message: string };
}
