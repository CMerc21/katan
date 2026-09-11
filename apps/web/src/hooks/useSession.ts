"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "@/lib/supabase";

export interface SessionState {
  readonly session: Session | null;
  readonly loading: boolean;
  readonly configured: boolean;
}

/** The Supabase session, kept in sync with auth state changes. */
export function useSession(): SessionState {
  const configured = supabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configured);

  useEffect(() => {
    if (!configured) return;
    const client = supabase();
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [configured]);

  return { session, loading, configured };
}

/** Redirect to /login (and back) when there is no session (docs/phase4.md §6). */
export function useRequireSession(): SessionState {
  const state = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!state.configured) {
      router.replace("/");
      return;
    }
    if (!state.loading && !state.session) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [state, router, pathname]);
  return state;
}
