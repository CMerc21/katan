"use client";

/**
 * Finding friends by username (docs/phase13.md §3.1): your own handle with
 * an inline editor, and a search box that looks players up by handle prefix
 * as you type (debounced; the newest query wins) with an Add / Accept button
 * on each result.
 */

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_LENGTH, liveRelation, normalizeUsername, searchable, usernameProblem, type PlayerHit, type Relation } from "@/social/model";
import { useSocial } from "@/social/SocialProvider";

/** `@ana` with Edit; editing checks the shape as you type and the server checks it is free. */
export function UsernameEditor() {
  const social = useSocial();
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const username = social.me?.username ?? "";

  if (draft === null) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-[10px] uppercase tracking-wider text-bone/60">Your username</span>
          <span className="block truncate font-mono text-base text-[#ffe9a8]" data-testid="my-username">
            {username ? `@${username}` : "…"}
          </span>
        </span>
        <button type="button" className="lb-dark px-2.5 py-1 text-xs" disabled={!username} onClick={() => setDraft(username)} data-testid="username-edit">
          Edit
        </button>
      </div>
    );
  }

  const shape = usernameProblem(draft);
  const save = async () => {
    if (shape) return setProblem(shape);
    if (normalizeUsername(draft) === username) return setDraft(null);
    setBusy(true);
    const r = await social.setUsername(draft);
    setBusy(false);
    if (!r.ok) return setProblem(r.message);
    setDraft(null);
    setProblem(null);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="block text-[10px] uppercase tracking-wider text-bone/60" htmlFor="username-input">
        Your username
      </label>
      <div className="mt-1 flex gap-1.5">
        <span className="relative min-w-0 flex-1">
          <span aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-sm text-bone/50">
            @
          </span>
          <input
            id="username-input"
            className="w-full rounded-md border border-gilt/40 bg-black/30 py-1 pl-6 pr-2 font-mono text-sm lowercase text-bone"
            value={draft}
            maxLength={21}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            aria-invalid={shape !== null}
            aria-describedby="username-help"
            onChange={(e) => {
              setDraft(e.target.value.replace(/^@/, ""));
              setProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation(); // close the editor, not the panel
                setDraft(null);
                setProblem(null);
              }
            }}
            data-testid="username-input"
          />
        </span>
        <button type="submit" className="lb-gold px-2.5 py-1 text-xs" disabled={busy || shape !== null} data-testid="username-save">
          Save
        </button>
        <button
          type="button"
          className="lb-dark px-2 py-1 text-xs"
          onClick={() => {
            setDraft(null);
            setProblem(null);
          }}
        >
          Cancel
        </button>
      </div>
      <p id="username-help" className={`mt-1 text-[11px] ${problem || shape ? "text-[#ffb4a3]" : "text-bone/55"}`} role={problem ? "alert" : undefined}>
        {problem ?? shape ?? "3 to 20 letters, digits or _. Friends can find you by it."}
      </p>
    </form>
  );
}

const ACTION: Record<Relation, string> = { none: "Add", outgoing: "Requested", incoming: "Accept", friends: "Friends" };

/** Search by username prefix; each result can be added (or a request from them accepted) in place. */
export function PlayerSearch() {
  const social = useSocial();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly PlayerHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const latest = useRef(0);
  // The provider's functions change identity whenever its value is rebuilt; search with the newest one
  // without re-running the search effect on every friend-list tick.
  const search = useRef(social.searchPlayers);
  search.current = social.searchPlayers;

  useEffect(() => {
    const id = ++latest.current;
    if (!searchable(query)) {
      setHits(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void search.current(query).then((r) => {
        if (id !== latest.current) return; // a newer query is on its way
        setLoading(false);
        if (r.ok) {
          setHits(r.players);
          setProblem(null);
        } else {
          setProblem(r.message);
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const act = async (hit: PlayerHit, relation: Relation) => {
    setBusy(hit.userId);
    const r = relation === "incoming" ? await social.respondFriendRequest(hit.userId, true) : await social.sendFriendRequest({ username: hit.username });
    setBusy(null);
    setProblem(r.ok ? null : r.message);
  };

  const trimmed = normalizeUsername(query);
  return (
    <div data-testid="player-search">
      <label className="sr-only" htmlFor="player-search-input">
        Search players by username
      </label>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-sm text-bone/50">
          @
        </span>
        <input
          id="player-search-input"
          type="search"
          className="w-full rounded-md border border-gilt/40 bg-black/30 py-1.5 pl-7 pr-2.5 font-mono text-sm text-bone placeholder:font-sans placeholder:text-bone/40"
          placeholder="Search by username"
          value={query}
          maxLength={21}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          aria-describedby="player-search-status"
          data-testid="player-search-input"
        />
      </div>
      <p id="player-search-status" className="sr-only" aria-live="polite">
        {loading ? "Searching" : hits ? `${hits.length} player${hits.length === 1 ? "" : "s"} found` : ""}
      </p>
      {trimmed.length > 0 && trimmed.length < SEARCH_MIN_LENGTH && <p className="mt-1 px-1 text-[11px] text-bone/55">Type at least {SEARCH_MIN_LENGTH} characters.</p>}
      {problem && (
        <p className="mt-1 px-1 text-xs text-[#ffb4a3]" role="alert">
          {problem}
        </p>
      )}
      {(loading || hits) && (
        <ul className="mt-1.5 space-y-1" aria-label="Search results" data-testid="player-search-results">
          {loading && !hits && <li className="px-1 text-xs italic text-bone/55">Searching…</li>}
          {hits?.length === 0 && !loading && <li className="px-1 text-xs italic text-bone/55">No players match @{trimmed}.</li>}
          {hits?.map((hit) => {
            const relation = liveRelation(hit, social.groups);
            const actionable = relation === "none" || relation === "incoming";
            return (
              <li key={hit.userId} className="flex items-center gap-2.5 rounded-lg bg-black/25 px-2 py-1.5" data-testid={`search-hit-${hit.username}`}>
                <Avatar spec={hit.avatar} color={hit.color ?? "blue"} name={hit.displayName} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{hit.displayName}</span>
                  <span className="block truncate font-mono text-[11px] text-bone/65">@{hit.username}</span>
                </span>
                <button
                  type="button"
                  className={actionable ? "lb-gold px-3 py-1 text-xs" : "lb-dark px-2.5 py-1 text-xs opacity-80"}
                  disabled={!actionable || busy === hit.userId}
                  onClick={() => void act(hit, relation)}
                  data-testid={`search-add-${hit.username}`}
                >
                  {busy === hit.userId ? "…" : ACTION[relation]}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
