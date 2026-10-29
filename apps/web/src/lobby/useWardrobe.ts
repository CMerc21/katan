"use client";

/**
 * The wardrobe's storage (docs/phase13.md §2): localStorage at once on every
 * change, and for a signed-in player the profile too (debounced), so the look
 * follows them to other devices and their friends see it. When a profile
 * already has a look it wins on arrival; otherwise the local look is pushed up.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSocial } from "@/social/SocialProvider";
import { WARDROBE_KEY, defaultWardrobe, parseWardrobe, sameWardrobe, type Wardrobe } from "./wardrobe";

const SAVE_DELAY_MS = 800;

/** The stored wardrobe, if any (the lobby page sends it when taking a seat by code). */
export function readWardrobe(): Wardrobe | null {
  try {
    const raw = window.localStorage.getItem(WARDROBE_KEY);
    return raw ? parseWardrobe(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** The `avatar` / `color` fields `create-lobby` and `join-game` accept, or nothing without a stored look. */
export function lookOf(w: Wardrobe | null): { avatar?: Wardrobe["avatar"]; color?: Wardrobe["color"] } {
  return w ? { avatar: w.avatar, color: w.color } : {};
}

function writeLocal(w: Wardrobe): void {
  try {
    window.localStorage.setItem(WARDROBE_KEY, JSON.stringify(w));
  } catch {
    /* private mode: the look lasts this visit */
  }
}

export function useWardrobe(): [Wardrobe, (next: Wardrobe) => void, boolean] {
  const social = useSocial();
  const [wardrobe, setWardrobe] = useState<Wardrobe>(() => defaultWardrobe());
  const [ready, setReady] = useState(false);
  const adopted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveProfile = social.saveProfile;

  // Local storage after mount, so the server render and the first client render agree.
  useEffect(() => {
    const local = readWardrobe();
    if (local) setWardrobe(local);
    setReady(true);
  }, []);

  // A signed-in profile with a look wins once; a profile without one gets ours.
  const me = social.me;
  useEffect(() => {
    if (!ready || !me || adopted.current) return;
    adopted.current = true;
    if (me.avatar) {
      const remote = parseWardrobe({ avatar: me.avatar, color: me.color ?? undefined, name: wardrobe.name }, wardrobe);
      if (!sameWardrobe(remote, wardrobe)) {
        setWardrobe(remote);
        writeLocal(remote);
      }
    } else {
      void saveProfile({ avatar: wardrobe.avatar, color: wardrobe.color });
    }
  }, [ready, me, wardrobe, saveProfile]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const update = useCallback(
    (next: Wardrobe) => {
      setWardrobe(next);
      writeLocal(next);
      if (!social.available) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveProfile({ avatar: next.avatar, color: next.color }), SAVE_DELAY_MS);
    },
    [social.available, saveProfile],
  );

  return [wardrobe, update, ready];
}
