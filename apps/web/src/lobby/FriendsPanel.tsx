"use client";

/**
 * The social sidebar (docs/phase13.md §3–§4): your friend code and an add
 * form, invites waiting on you, "Invite to your party" with a direct button
 * per online friend, then Online, Offline and Pending requests. Slides in
 * from the left over the scene; Esc or × closes it.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { InviteCard } from "@/social/InviteToasts";
import { formatFriendCode, invitableFriends, normalizeFriendCode, statusText, type FriendEntry, type InviteState } from "@/social/model";
import { useSocial } from "@/social/SocialProvider";

export interface PartyInfo {
  readonly gameId: string;
  readonly joinCode: string;
  readonly seatedUserIds: readonly string[];
  readonly openSeats: number;
}

const INVITE_LABEL: Record<InviteState, string> = { invite: "Invite", invited: "Invited", seated: "In party", full: "Full" };

function Section({ title, count, children, testId }: { title: string; count?: number; children: ReactNode; testId: string }) {
  return (
    <section className="mt-4" aria-label={title} data-testid={testId}>
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-bone/80">
        {title}
        {count !== undefined && <span className="rounded-full bg-black/40 px-1.5 text-[10px] text-bone/80">{count}</span>}
      </h3>
      <div className="mt-1.5 space-y-1">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-1 text-xs italic text-bone/55">{children}</p>;
}

function FriendRow({ entry, now, children }: { entry: FriendEntry; now: number; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-black/25 px-2 py-1.5" data-testid={`friend-${entry.userId}`}>
      <span className="relative">
        <Avatar spec={entry.profile?.avatar} color={entry.profile?.color ?? "blue"} name={entry.name} size={34} />
        <span aria-hidden className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#26221e] ${entry.online ? "bg-[#6fcf5a]" : "bg-[#7d8089]"}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{entry.name}</span>
        <span className="block truncate text-[11px] text-bone/65">{statusText(entry, now)}</span>
      </span>
      {children}
    </div>
  );
}

function RemoveButton({ onRemove, label = "Remove" }: { onRemove: () => void; label?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      className={`rounded px-2 py-1 text-[11px] ${armed ? "bg-[#b83a2c] text-white" : "text-bone/60 hover:text-bone"}`}
      onClick={() => (armed ? onRemove() : setArmed(true))}
      onBlur={() => setArmed(false)}
    >
      {armed ? "Sure?" : label}
    </button>
  );
}

export function FriendsPanel({ party, onInvite, onClose }: { party: PartyInfo | null; onInvite: (userId: string) => Promise<string | null>; onClose: () => void }) {
  const social = useSocial();
  const [code, setCode] = useState("");
  const [note, setNote] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const me = social.me;

  if (!social.available) {
    return (
      <section className="lb-plaque lb-sheet lb-sheet-left w-[min(22rem,calc(100vw-1.5rem))] p-4" aria-label="Friends" data-testid="friends-panel">
        <Header onClose={onClose} />
        <p className="mt-3 text-sm text-bone/80">Friends, parties and invites need an account, so your friends can find you.</p>
        <Link href="/login?next=/" className="lb-gold mt-4 inline-block px-4 py-1.5 text-sm" data-testid="friends-sign-in">
          Sign in
        </Link>
        <p className="mt-3 text-xs text-bone/60">Solo and hotseat games work without one.</p>
      </section>
    );
  }

  const groups = social.groups;
  const invitable = invitableFriends(groups, party, social.invites, me?.userId ?? "", social.now);

  const add = async () => {
    const clean = normalizeFriendCode(code);
    if (clean.length !== 8) return setNote({ text: "Friend codes are 8 letters and digits", tone: "bad" });
    setBusy("add");
    const r = await social.sendFriendRequest(clean);
    setBusy(null);
    if (!r.ok) return setNote({ text: r.message, tone: "bad" });
    setCode("");
    setNote({ text: r.status === "accepted" ? "You are now friends" : "Request sent", tone: "ok" });
  };

  const copy = async () => {
    if (!me) return;
    try {
      await navigator.clipboard.writeText(formatFriendCode(me.friendCode));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setNote({ text: "Copy failed; select the code instead", tone: "bad" });
    }
  };

  const invite = async (userId: string) => {
    setBusy(userId);
    const problem = await onInvite(userId);
    setBusy(null);
    setNote(problem ? { text: problem, tone: "bad" } : null);
  };

  return (
    <section className="lb-plaque lb-sheet lb-sheet-left w-[min(22rem,calc(100vw-1.5rem))] p-4" aria-label="Friends" data-testid="friends-panel">
      <Header onClose={onClose} />

      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-black/30 px-3 py-2">
        <span>
          <span className="block text-[10px] uppercase tracking-wider text-bone/60">Your friend code</span>
          <span className="font-mono text-lg tracking-[0.15em] text-[#ffe9a8]" data-testid="my-friend-code">
            {me ? formatFriendCode(me.friendCode) : "…"}
          </span>
        </span>
        <button type="button" className="lb-dark px-2.5 py-1 text-xs" onClick={() => void copy()} disabled={!me}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label className="sr-only" htmlFor="friend-code">
          Friend code
        </label>
        <input
          id="friend-code"
          className="min-w-0 flex-1 rounded-md border border-gilt/40 bg-black/30 px-2.5 py-1.5 font-mono text-sm uppercase tracking-widest text-bone placeholder:text-bone/40"
          placeholder="ABCD-EFGH"
          value={code}
          maxLength={9}
          onChange={(e) => setCode(e.target.value)}
          data-testid="friend-code-input"
        />
        <button type="submit" className="lb-gold px-3 py-1.5 text-sm" disabled={busy === "add"} data-testid="friend-add">
          Add friend
        </button>
      </form>
      {note && (
        <p className={`mt-1.5 text-xs ${note.tone === "ok" ? "text-[#a9e08f]" : "text-[#ffb4a3]"}`} role={note.tone === "bad" ? "alert" : "status"}>
          {note.text}
        </p>
      )}

      {social.incomingInvites.length > 0 && (
        <Section title="Game invites" count={social.incomingInvites.length} testId="friends-invites">
          {social.incomingInvites.map((i) => (
            <InviteCard key={i.id} invite={i} color={[...groups.online, ...groups.offline].find((f) => f.userId === i.fromUser)?.profile?.color ?? undefined} inline onRespond={(inv, accept) => void social.respondInvite(inv, accept)} />
          ))}
        </Section>
      )}

      <Section title="Invite to your party" testId="friends-invite">
        <p className="px-1 text-[11px] text-bone/60">{party ? `Lobby ${party.joinCode} · ${party.openSeats} open seat${party.openSeats === 1 ? "" : "s"}` : "Inviting opens a lobby for your party."}</p>
        {invitable.length === 0 && <Empty>No friends online right now.</Empty>}
        {invitable.map(({ entry, state }) => (
          <FriendRow key={entry.userId} entry={entry} now={social.now}>
            <button
              type="button"
              className={state === "invite" ? "lb-gold px-3 py-1 text-xs" : "lb-dark px-2.5 py-1 text-xs opacity-80"}
              disabled={state !== "invite" || busy === entry.userId}
              onClick={() => void invite(entry.userId)}
              data-testid={`invite-friend-${entry.userId}`}
            >
              {busy === entry.userId ? "…" : INVITE_LABEL[state]}
            </button>
          </FriendRow>
        ))}
      </Section>

      <Section title="Online" count={groups.online.length} testId="friends-online">
        {groups.online.length === 0 && <Empty>Nobody online.</Empty>}
        {groups.online.map((e) => (
          <FriendRow key={e.userId} entry={e} now={social.now}>
            <RemoveButton onRemove={() => void social.removeFriend(e.userId)} />
          </FriendRow>
        ))}
      </Section>

      <Section title="Offline" count={groups.offline.length} testId="friends-offline">
        {groups.offline.length === 0 && <Empty>{groups.online.length === 0 ? "Share your code to add your first friend." : "Everyone is here."}</Empty>}
        {groups.offline.map((e) => (
          <FriendRow key={e.userId} entry={e} now={social.now}>
            <RemoveButton onRemove={() => void social.removeFriend(e.userId)} />
          </FriendRow>
        ))}
      </Section>

      <Section title="Pending requests" count={groups.incoming.length + groups.outgoing.length} testId="friends-pending">
        {groups.incoming.length + groups.outgoing.length === 0 && <Empty>No open requests.</Empty>}
        {groups.incoming.map((e) => (
          <FriendRow key={e.userId} entry={e} now={social.now}>
            <span className="flex gap-1">
              <button type="button" className="lb-gold px-2.5 py-1 text-xs" onClick={() => void social.respondFriendRequest(e.userId, true)} data-testid={`friend-accept-${e.userId}`}>
                Accept
              </button>
              <button type="button" className="lb-dark px-2 py-1 text-xs" onClick={() => void social.respondFriendRequest(e.userId, false)} data-testid={`friend-decline-${e.userId}`}>
                Decline
              </button>
            </span>
          </FriendRow>
        ))}
        {groups.outgoing.map((e) => (
          <FriendRow key={e.userId} entry={{ ...e, online: false }} now={social.now}>
            <span className="text-[11px] italic text-bone/55">Sent</span>
            <RemoveButton label="Cancel" onRemove={() => void social.removeFriend(e.userId)} />
          </FriendRow>
        ))}
      </Section>
    </section>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <header className="flex items-center justify-between">
      <h2 className="font-display text-xl text-[#ffe9a8]">Friends</h2>
      <button type="button" className="rounded px-2 text-2xl leading-none text-bone/70 hover:text-bone" aria-label="Close friends" onClick={onClose} data-testid="friends-close">
        ×
      </button>
    </header>
  );
}
