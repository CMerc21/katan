"use client";

/**
 * Incoming game invites as small corner toasts (docs/phase13.md §4): slide in
 * at the top right, show who asked and where, offer Accept / Decline, and fold
 * away after TOAST_VISIBLE_MS into the Friends panel's invite list. Never
 * modal, never steals focus; announced politely to screen readers.
 */

import type { PlayerColor } from "@katan/engine";
import { Avatar } from "@/components/Avatar";
import { TOAST_VISIBLE_MS, type Invite, type InviteToast } from "./model";

export function InviteToasts({
  toasts,
  onRespond,
  onDismiss,
  colorOf,
}: {
  toasts: readonly InviteToast[];
  onRespond: (invite: Invite, accept: boolean) => void;
  onDismiss: (id: string) => void;
  /** The sender's wardrobe colour, for their portrait. */
  colorOf?: (userId: string) => PlayerColor | null;
}) {
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[70] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2" role="region" aria-label="Game invites" aria-live="polite" data-testid="invite-toasts">
      {toasts.map(({ invite }) => (
        <InviteCard key={invite.id} invite={invite} color={colorOf?.(invite.fromUser) ?? undefined} onRespond={onRespond} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

export function InviteCard({
  invite,
  color = "blue",
  onRespond,
  onDismiss,
  inline = false,
}: {
  invite: Invite;
  color?: PlayerColor | undefined;
  onRespond: (invite: Invite, accept: boolean) => void;
  onDismiss?: (id: string) => void;
  inline?: boolean;
}) {
  return (
    <div className={`lb-plaque pointer-events-auto relative overflow-hidden px-3 py-2.5 ${inline ? "" : "lb-toast-in"}`} role="status" data-testid={`invite-${invite.id}`}>
      <div className="flex items-start gap-3">
        <Avatar spec={invite.fromAvatar} color={color} name={invite.fromName} size={40} className="mt-0.5 border-gilt/80" />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-bone">
            <span className="font-semibold">{invite.fromName}</span> invites you to play
          </p>
          <p className="truncate text-xs text-bone/70">
            {invite.boardName ?? "A game"} · lobby <span className="font-mono tracking-wider">{invite.joinCode}</span>
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="lb-gold px-3 py-1 text-sm" onClick={() => onRespond(invite, true)} data-testid="invite-accept">
              Accept
            </button>
            <button type="button" className="lb-dark px-3 py-1 text-sm" onClick={() => onRespond(invite, false)} data-testid="invite-decline">
              Decline
            </button>
          </div>
        </div>
        {onDismiss && (
          <button type="button" className="-mr-1 -mt-1 rounded px-1.5 text-lg leading-none text-bone/60 hover:text-bone" aria-label="Later: keep this invite in the Friends panel" title="Later" onClick={() => onDismiss(invite.id)}>
            ×
          </button>
        )}
      </div>
      {!inline && <span aria-hidden className="lb-toast-timer absolute bottom-0 left-0 h-0.5 bg-gilt" style={{ animationDuration: `${TOAST_VISIBLE_MS}ms` }} />}
    </div>
  );
}
