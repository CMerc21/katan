"use client";

/**
 * The home lobby (docs/phase13.md §1): a painted valley with your character
 * standing on the road, party slots either side of them, a profile badge top
 * left, the library top right, rails of plaque buttons down both sides, the
 * Solo / Online switch bottom left and Play bottom right. Panels slide in
 * over the scene (friends from the left; wardrobe, play and settings from
 * the right) and never cover the character entirely on a wide screen.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AvatarSpec } from "@katan/avatars";
import type { PlayerColor } from "@katan/engine";
import { Avatar } from "@/components/Avatar";
import { SettingsBody } from "@/hud/SettingsMenu";
import { useSession } from "@/hooks/useSession";
import { displayNameOf, signOut } from "@/lib/supabase";
import { formatFriendCode, INVITE_TTL_MS } from "@/social/model";
import { useSocial } from "@/social/SocialProvider";
import { Figure } from "./Figure";
import { FriendsPanel, type PartyInfo } from "./FriendsPanel";
import { AddPersonIcon, BookIcon, Chevron, DiceIcon, FriendsIcon, GearIcon, PeopleIcon, PersonIcon, ScrollIcon, WardrobeIcon } from "./icons";
import { LobbyScene } from "./LobbyScene";
import { PlaySheet, type Mode } from "./PlaySheet";
import { useParty } from "./useParty";
import { useWardrobe } from "./useWardrobe";
import { CATEGORIES, cycle, layerInfo, primaryLayer, titleFor, wornSummary, type CategoryKey } from "./wardrobe";
import { WardrobePanel } from "./WardrobePanel";

type Panel = "friends" | "wardrobe" | "play" | "settings" | null;

function RailButton({ label, icon, onClick, href, badge, expanded, testId }: { label: string; icon: ReactNode; onClick?: () => void; href?: string; badge?: number; expanded?: boolean; testId: string }) {
  const inner = (
    <>
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && <span className="lb-badge">{badge > 9 ? "9+" : badge}</span>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="lb-plaque lb-rail-btn" aria-label={label} data-testid={testId}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className="lb-plaque lb-rail-btn" aria-label={label} aria-expanded={expanded} onClick={onClick} data-testid={testId}>
      {inner}
    </button>
  );
}

/** A party seat beside your character: a friend's figure, a pending invite, or an empty hex to invite into. */
function PartySlot({ seat, onInvite, side }: { seat: { name: string; avatar: AvatarSpec | null; color: PlayerColor; state: "seated" | "ready" | "invited" | "bot" } | null; onInvite: () => void; side: string }) {
  if (!seat) {
    return (
      <button type="button" className="lb-slot lb-hex lb-hex-frame grid h-[4.6rem] w-[4rem] place-items-center sm:h-[5.6rem] sm:w-[4.9rem]" onClick={onInvite} aria-label="Invite a friend to your party" data-testid={`party-slot-${side}`}>
        <span className="lb-hex grid h-full w-full place-items-center bg-[#2b2622] text-bone/85">
          <AddPersonIcon className="h-8 w-8 sm:h-9 sm:w-9" />
        </span>
      </button>
    );
  }
  const label = seat.state === "invited" ? "Invited…" : seat.state === "ready" ? "Ready" : seat.state === "bot" ? "Bot" : "In party";
  return (
    <div className={`flex flex-col items-center ${seat.state === "invited" ? "opacity-60" : ""}`} data-testid={`party-slot-${side}`}>
      <span className="lb-nameplate mb-1 max-w-[9rem] truncate text-sm">{seat.name}</span>
      {seat.avatar ? <Figure spec={seat.avatar} color={seat.color} height={150} idle label={seat.name} /> : <Avatar spec={null} color={seat.color} name={seat.name} size={72} />}
      <span className={`lb-plaque -mt-2 px-2 py-0.5 text-[10px] uppercase tracking-wider ${seat.state === "ready" ? "text-[#a9e08f]" : ""}`}>{label}</span>
    </div>
  );
}

export function HomeLobby() {
  const { session, configured, loading } = useSession();
  const social = useSocial();
  const [wardrobe, setWardrobe, wardrobeReady] = useWardrobe();
  const { games, party, ensureParty } = useParty();
  const [panel, setPanel] = useState<Panel>(null);
  const [category, setCategory] = useState<CategoryKey>("outfit");
  const [mode, setMode] = useState<Mode>("solo");
  const [modeTouched, setModeTouched] = useState(false);

  // Signed in means Online by default; a guest starts on Solo.
  useEffect(() => {
    if (!loading && !modeTouched) setMode(session ? "online" : "solo");
  }, [loading, session, modeTouched]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const name = session ? displayNameOf(session) : wardrobe.name;
  const title = titleFor(wardrobe.avatar);
  const me = session?.user.id ?? null;

  const partyInfo: PartyInfo | null = party ? { gameId: party.game.id, joinCode: party.game.join_code, seatedUserIds: party.seats.flatMap((s) => (s.userId ? [s.userId] : [])), openSeats: party.game.max_players - party.seats.length } : null;

  const slots = useMemo(() => {
    const others = (party?.seats ?? []).filter((s) => s.userId !== me).map((s) => ({ name: s.name, avatar: s.avatar, color: s.color, state: s.kind === "bot" ? ("bot" as const) : s.ready ? ("ready" as const) : ("seated" as const) }));
    const invited = party
      ? social.invites
          .filter((i) => i.gameId === party.game.id && i.fromUser === me && i.status === "pending" && social.now - i.createdAt <= INVITE_TTL_MS)
          .map((i) => {
            const friend = [...social.groups.online, ...social.groups.offline].find((f) => f.userId === i.toUser);
            return { name: friend?.name ?? "Friend", avatar: friend?.profile?.avatar ?? null, color: friend?.profile?.color ?? ("blue" as PlayerColor), state: "invited" as const };
          })
      : [];
    const filled = [...others, ...invited];
    const count = Math.max(2, Math.min(3, (party?.game.max_players ?? 3) - 1));
    return Array.from({ length: count }, (_, i) => filled[i] ?? null);
  }, [party, me, social.invites, social.groups, social.now]);

  const onInvite = useCallback(
    async (userId: string): Promise<string | null> => {
      const p = await ensureParty({ avatar: wardrobe.avatar, color: wardrobe.color });
      if ("problem" in p) return p.problem;
      const r = await social.invite(p.gameId, userId);
      return r.ok ? null : r.message;
    },
    [ensureParty, social, wardrobe.avatar, wardrobe.color],
  );

  const activeLayer = primaryLayer(category);
  const activeInfo = layerInfo(activeLayer);
  const pendingCount = social.groups.incoming.length + social.incomingInvites.length;
  const activeGame = games.find((g) => g.status === "active");

  return (
    <main className="lb-root fixed inset-0 overflow-hidden" data-testid="home-lobby">
      <LobbyScene />

      {/* Showcase: your character on the road, party slots either side. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-24 flex items-end justify-center gap-[3vw] sm:bottom-[5vh] sm:gap-[7vw]">
        <div className="pointer-events-auto mb-6 hidden items-end gap-[3vw] sm:flex sm:gap-[6vw]">
          {slots[2] !== undefined && (
            <span className="hidden lg:block">
              <PartySlot seat={slots[2]} side="far" onInvite={() => setPanel("friends")} />
            </span>
          )}
          <PartySlot seat={slots[0] ?? null} side="left" onInvite={() => setPanel("friends")} />
        </div>

        <div className="pointer-events-auto flex flex-col items-center" data-testid="showcase">
          <div className="lb-ribbon px-6 pb-1 pt-0.5 text-center">
            <p className="lb-nameplate text-lg leading-tight sm:text-2xl" data-testid="showcase-name">
              {name}
            </p>
            <p className="lb-nameplate text-xs leading-tight opacity-90 sm:text-sm" data-testid="showcase-title">
              {title}
            </p>
          </div>
          <div className="relative mt-1 flex items-center">
            <button type="button" className="lb-dark grid h-10 w-10 place-items-center rounded-full" aria-label={`Previous ${activeInfo.label}`} onClick={() => setWardrobe(cycle(wardrobe, activeLayer, -1))} data-testid="showcase-prev">
              <Chevron dir="left" className="h-5 w-5" />
            </button>
            <button type="button" className="mx-1 cursor-pointer rounded-xl focus-visible:outline-offset-4" onClick={() => toggle("wardrobe")} aria-label={`Customise ${name}`} data-testid="showcase-figure">
              <Figure
                spec={wardrobe.avatar}
                color={wardrobe.color}
                idle
                pop={wardrobeReady}
                className="[&_svg]:h-[min(38vh,25rem)] [&_svg]:w-auto sm:[&_svg]:h-[min(46vh,25rem)]"
                label={`${name} ${title}, wearing ${wornSummary(wardrobe.avatar) || "plain clothes"}`}
              />
            </button>
            <button type="button" className="lb-dark grid h-10 w-10 place-items-center rounded-full" aria-label={`Next ${activeInfo.label}`} onClick={() => setWardrobe(cycle(wardrobe, activeLayer, 1))} data-testid="showcase-next">
              <Chevron dir="right" className="h-5 w-5" />
            </button>
          </div>
          <div className="lb-plaque -mt-3 flex items-center gap-1 px-1 py-1 text-xs">
            <select
              className="rounded bg-transparent px-1 py-0.5 text-bone outline-none [&>option]:text-ink"
              aria-label="Showcase category"
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryKey)}
              data-testid="showcase-category"
            >
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="min-w-[5.5rem] text-center font-semibold" data-testid="showcase-option">
              {activeInfo.options[wardrobe.avatar[activeLayer]]}
            </span>
            <button type="button" className="lb-gold px-2.5 py-0.5 text-xs" onClick={() => toggle("wardrobe")} aria-expanded={panel === "wardrobe"} data-testid="open-wardrobe">
              Customise
            </button>
          </div>
        </div>

        <div className="pointer-events-auto mb-6 hidden items-end sm:flex">
          <PartySlot seat={slots[1] ?? null} side="right" onInvite={() => setPanel("friends")} />
        </div>
      </div>

      {/* Top left: profile badge. */}
      <div className="absolute left-3 top-3 flex items-start gap-2">
        <button type="button" className="lb-slot flex flex-col items-center" onClick={() => toggle("wardrobe")} aria-label="Profile and wardrobe" data-testid="profile-badge">
          <span className="lb-hex lb-hex-frame block h-[5.2rem] w-[4.6rem] sm:h-[6.2rem] sm:w-[5.4rem]">
            <span className="lb-hex lb-hex-inner grid h-full w-full place-items-center">
              <Avatar spec={wardrobe.avatar} color={wardrobe.color} name={name} size={58} className="border-0" />
            </span>
          </span>
          <span className="lb-plaque -mt-3 px-2.5 py-0.5 font-display text-[11px] uppercase tracking-widest">Profile</span>
        </button>
        <div className="lb-plaque mt-2 hidden max-w-[15rem] px-3 py-1.5 sm:block">
          <p className="truncate font-display text-sm tracking-wider" data-testid="profile-name">
            {name}
          </p>
          {session ? (
            <p className="text-[11px] text-bone/70">
              {social.me ? <span className="font-mono tracking-wider">{formatFriendCode(social.me.friendCode)}</span> : "…"} ·{" "}
              <button type="button" className="underline hover:text-bone" onClick={() => void signOut()}>
                sign out
              </button>
            </p>
          ) : configured ? (
            <p className="text-[11px] text-bone/70">
              Guest ·{" "}
              <Link className="underline hover:text-bone" href="/login?next=/" data-testid="profile-sign-in">
                sign in
              </Link>
            </p>
          ) : (
            <p className="text-[11px] text-bone/70">Playing on this device</p>
          )}
        </div>
      </div>

      {/* Top centre: the name of the game, and a rejoin chip when a game is waiting. */}
      <div className="absolute left-1/2 top-3 hidden -translate-x-1/2 flex-col items-center md:flex">
        <div className="lb-plaque px-6 py-1.5 text-center" style={{ background: "linear-gradient(180deg,#f7efd9,#e6d8b4)", color: "#211d19", borderColor: "#8a6a22" }}>
          <h1 className="font-display text-2xl font-semibold leading-tight">Katan</h1>
          <p className="text-[11px] tracking-wide text-ink-soft">A hex settlement game for friends</p>
        </div>
        {activeGame && (
          <Link href={`/play/${activeGame.id}`} className="lb-gold mt-2 px-3 py-1 text-xs" data-testid="rejoin">
            Game in play · Rejoin
          </Link>
        )}
      </div>

      {/* Top right: the library. */}
      <Link href="/boards" className="lb-slot absolute right-3 top-3 flex flex-col items-center" aria-label="Boards and scenarios" data-testid="home-boards">
        <span className="lb-hex lb-hex-frame block h-[5.2rem] w-[4.6rem] sm:h-[6.2rem] sm:w-[5.4rem]">
          <span className="lb-hex grid h-full w-full place-items-center" style={{ background: "radial-gradient(circle at 50% 35%, #3f6f8f, #1f3a52 70%)" }}>
            <BookIcon className="h-10 w-10 text-[#ffe9a8]" />
          </span>
        </span>
        <span className="lb-plaque -mt-3 px-2.5 py-0.5 font-display text-[11px] uppercase tracking-widest">Boards</span>
      </Link>

      {/* Rails. */}
      <nav className="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col gap-2.5" aria-label="Social">
        <RailButton label="Friends" icon={<FriendsIcon />} onClick={() => toggle("friends")} expanded={panel === "friends"} badge={pendingCount} testId="rail-friends" />
        <RailButton label="Wardrobe" icon={<WardrobeIcon />} onClick={() => toggle("wardrobe")} expanded={panel === "wardrobe"} testId="rail-wardrobe" />
        <RailButton
          label="Games"
          icon={<ScrollIcon />}
          onClick={() => {
            setMode("online");
            setModeTouched(true);
            setPanel("play");
          }}
          badge={games.length}
          testId="rail-games"
        />
      </nav>
      <nav className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-2.5" aria-label="More">
        <RailButton label="Library" icon={<BookIcon />} href="/boards" testId="rail-boards" />
        <RailButton label="Editor" icon={<ScrollIcon />} href="/boards/editor" testId="rail-editor" />
        <RailButton label="Settings" icon={<GearIcon />} onClick={() => toggle("settings")} expanded={panel === "settings"} testId="rail-settings" />
      </nav>

      {/* Bottom left: Solo / Online. */}
      <div className="lb-plaque lb-segment absolute bottom-3 left-3" role="radiogroup" aria-label="Play mode">
        {(["solo", "online"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => {
              setMode(m);
              setModeTouched(true);
            }}
            data-testid={`mode-${m}`}
          >
            {m === "solo" ? <PersonIcon /> : <PeopleIcon />}
            {m === "solo" ? "Solo" : "Online"}
          </button>
        ))}
      </div>

      {/* Bottom right: Play. */}
      <button type="button" className="lb-gold lb-play absolute bottom-3 right-3 flex items-center gap-3" onClick={() => toggle("play")} aria-expanded={panel === "play"} data-testid="lobby-play">
        Play <DiceIcon className="h-8 w-8" />
      </button>

      {/* Panels. */}
      {panel === "friends" && (
        <div className="absolute left-3 top-3 z-30">
          <FriendsPanel party={partyInfo} onInvite={onInvite} onClose={() => setPanel(null)} />
        </div>
      )}
      {panel === "wardrobe" && (
        <div className="absolute right-3 top-3 z-30">
          <WardrobePanel wardrobe={wardrobe} onChange={setWardrobe} category={category} onCategory={setCategory} onClose={() => setPanel(null)} guestName={!session} />
        </div>
      )}
      {panel === "play" && (
        <div className="absolute right-3 top-3 z-30">
          <PlaySheet mode={mode} session={session} configured={configured} wardrobe={wardrobe} games={games} party={party} onClose={() => setPanel(null)} />
        </div>
      )}
      {panel === "settings" && (
        <section className="lb-plaque lb-sheet lb-sheet-right absolute right-3 top-3 z-30 w-[min(22rem,calc(100vw-1.5rem))] p-4" aria-label="Settings" data-testid="lobby-settings">
          <header className="flex items-center justify-between">
            <h2 className="font-display text-xl text-[#ffe9a8]">Settings</h2>
            <button type="button" className="rounded px-2 text-2xl leading-none text-bone/70 hover:text-bone" aria-label="Close settings" onClick={() => setPanel(null)}>
              ×
            </button>
          </header>
          <div className="parchment mt-3 rounded-md px-3 py-3 text-ink">
            <SettingsBody showGraphics />
          </div>
        </section>
      )}
    </main>
  );
}
