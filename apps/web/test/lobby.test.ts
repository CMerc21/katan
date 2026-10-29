import { describe, expect, it } from "vitest";
import { AVATAR_LAYERS, avatarFromSeed, isAvatarSpec, seededRng } from "@katan/avatars";
import { CATEGORIES, GUEST_NAME, cycle, defaultWardrobe, equip, parseWardrobe, primaryLayer, sameWardrobe, shuffle, titleFor, withColor, withName, wornSummary } from "@/lobby/wardrobe";
import {
  INVITE_TTL_MS,
  MAX_TOASTS,
  ONLINE_WINDOW_MS,
  TOAST_VISIBLE_MS,
  EMPTY_TOASTS,
  formatFriendCode,
  friendshipFromRow,
  groupFriends,
  inviteFromRow,
  invitableFriends,
  isOnline,
  lastSeenText,
  normalizeFriendCode,
  openInvites,
  profileFromRow,
  statusText,
  toastReducer,
  type Friendship,
  type Invite,
  type Profile,
} from "@/social/model";

const NOW = 1_800_000_000_000;

describe("docs/phase13.md §2 wardrobe", () => {
  it("covers every avatar layer exactly once across the categories", () => {
    const layers = CATEGORIES.flatMap((c) => c.layers);
    expect([...layers].sort()).toEqual(AVATAR_LAYERS.map((l) => l.key).sort());
    expect(primaryLayer("outfit")).toBe("garment");
    expect(CATEGORIES.filter((c) => c.colour).map((c) => c.key)).toEqual(["outfit"]);
  });

  it("equips, cycles with wrap-around, recolours and renames without touching other layers", () => {
    const w = defaultWardrobe("t");
    const cloak = equip(w, "garment", 3);
    expect(cloak.avatar.garment).toBe(3);
    expect({ ...cloak.avatar, garment: w.avatar.garment }).toEqual(w.avatar);
    expect(equip(cloak, "garment", 3)).toBe(cloak);
    expect(equip(w, "accessory", 7).avatar.accessory).toBe(2);
    expect(cycle({ ...w, avatar: { ...w.avatar, headwear: 8 } }, "headwear", 1).avatar.headwear).toBe(0);
    expect(cycle({ ...w, avatar: { ...w.avatar, headwear: 0 } }, "headwear", -1).avatar.headwear).toBe(8);
    expect(withColor(w, "green").color).toBe("green");
    expect(withName(w, "  Ana  ").name).toBe("Ana");
    expect(withName(w, "   ").name).toBe(GUEST_NAME);
    expect(sameWardrobe(w, { ...w })).toBe(true);
    expect(sameWardrobe(w, cloak)).toBe(false);
    const s = shuffle(w, seededRng("x"));
    expect(isAvatarSpec(s.avatar)).toBe(true);
    expect(shuffle(w, seededRng("x"))).toEqual(s);
  });

  it("parses untrusted storage field by field", () => {
    const fallback = defaultWardrobe("f");
    expect(parseWardrobe(null, fallback)).toEqual(fallback);
    expect(parseWardrobe("junk", fallback)).toEqual(fallback);
    const spec = avatarFromSeed("p");
    expect(parseWardrobe({ avatar: spec, color: "orange", name: "Bo" }, fallback)).toEqual({ avatar: spec, color: "orange", name: "Bo" });
    const fixed = parseWardrobe({ avatar: { ...spec, hair: 99 }, color: "pink", name: 4 }, fallback);
    expect(isAvatarSpec(fixed.avatar)).toBe(true);
    expect(fixed.color).toBe(fallback.color);
    expect(fixed.name).toBe(fallback.name);
  });

  it("gives an epithet from the most striking thing worn and a summary that skips None", () => {
    const base = { ...avatarFromSeed("e"), headwear: 8, accessory: 4, garment: 0 };
    expect(titleFor(base)).toBe("the Settler");
    expect(titleFor({ ...base, garment: 3 })).toBe("the Wanderer");
    expect(titleFor({ ...base, garment: 3, accessory: 3 })).toBe("the Falconer");
    expect(titleFor({ ...base, accessory: 3, headwear: 6 })).toBe("the Crowned");
    expect(wornSummary(base)).toBe("Tunic");
    expect(wornSummary({ ...base, headwear: 6, accessory: 2 })).toBe("Tunic, Crown, Lantern");
  });
});

function profile(userId: string, name: string, seenAgo: number, activity: Profile["activity"] = "menu"): Profile {
  return { userId, name, friendCode: "ABCDEFGH", avatar: null, color: null, activity, lastSeenAt: NOW - seenAgo };
}

function invite(id: string, over: Partial<Invite> = {}): Invite {
  return { id, gameId: "g1", fromUser: "ana", toUser: "me", fromName: "Ana", fromAvatar: null, joinCode: "ABCDEF", boardName: "Beginner", status: "pending", createdAt: NOW, ...over };
}

describe("docs/phase13.md §3 friend list", () => {
  const profiles = new Map<string, Profile>([
    ["ana", profile("ana", "Ana", 10_000, "game")],
    ["ben", profile("ben", "Ben", 30_000)],
    ["cal", profile("cal", "Cal", ONLINE_WINDOW_MS + 1)],
    ["dot", profile("dot", "Dot", 3 * 3_600_000)],
    ["eve", profile("eve", "Eve", 0)],
    ["fay", profile("fay", "Fay", 0)],
  ]);
  const f = (requester: string, addressee: string, status: Friendship["status"] = "accepted"): Friendship => ({ requester, addressee, status, createdAt: NOW });
  const friendships = [f("me", "ana"), f("ben", "me"), f("me", "cal"), f("dot", "me"), f("eve", "me", "pending"), f("me", "fay", "pending"), f("x", "y")];

  it("splits Online, Offline and the two pending lists; online sorted free first, offline most recent first", () => {
    const g = groupFriends("me", friendships, profiles, NOW);
    expect(g.online.map((e) => e.name)).toEqual(["Ben", "Ana"]);
    expect(g.offline.map((e) => e.name)).toEqual(["Cal", "Dot"]);
    expect(g.incoming.map((e) => e.name)).toEqual(["Eve"]);
    expect(g.outgoing.map((e) => e.name)).toEqual(["Fay"]);
    expect(statusText(g.online[0]!, NOW)).toBe("In the village");
    expect(statusText(g.online[1]!, NOW)).toBe("In a game");
    expect(statusText(g.offline[1]!, NOW)).toBe("Seen 3 h ago");
    expect(isOnline(null, NOW)).toBe(false);
    expect(lastSeenText(0, NOW)).toBe("Not seen yet");
    expect(lastSeenText(NOW - 30_000, NOW)).toBe("Seen 1 min ago");
    expect(lastSeenText(NOW - 2 * 86_400_000, NOW)).toBe("Seen 2 days ago");
  });

  it("knows who can be invited to the party", () => {
    const g = groupFriends("me", friendships, profiles, NOW);
    const party = { gameId: "g1", seatedUserIds: ["me"], openSeats: 2 };
    const sent = [invite("i1", { fromUser: "me", toUser: "ana" }), invite("i2", { fromUser: "me", toUser: "ben", gameId: "other" })];
    expect(invitableFriends(g, party, sent, "me", NOW).map((x) => [x.entry.name, x.state])).toEqual([
      ["Ben", "invite"],
      ["Ana", "invited"],
    ]);
    expect(invitableFriends(g, { ...party, seatedUserIds: ["me", "ben"] }, [], "me", NOW)[0]!.state).toBe("seated");
    expect(invitableFriends(g, { ...party, openSeats: 0 }, [], "me", NOW)[0]!.state).toBe("full");
    // A lapsed invite can be sent again.
    expect(invitableFriends(g, party, [invite("i3", { fromUser: "me", toUser: "ana", createdAt: NOW - INVITE_TTL_MS - 1 })], "me", NOW)[1]!.state).toBe("invite");
    expect(invitableFriends(g, null, sent, "me", NOW).every((x) => x.state === "invite")).toBe(true);
  });

  it("maps rows defensively and formats codes", () => {
    const p = profileFromRow({ user_id: "u", display_name: "", friend_code: "ABCDEFGH", avatar: { skin: 1 }, color: "pink", activity: "dancing", last_seen_at: new Date(NOW).toISOString() });
    expect(p).toEqual({ userId: "u", name: "Player", friendCode: "ABCDEFGH", avatar: null, color: null, activity: "menu", lastSeenAt: NOW });
    expect(friendshipFromRow({ requester: "a", addressee: "b", status: "weird", created_at: "bad" })).toEqual({ requester: "a", addressee: "b", status: "pending", createdAt: 0 });
    const i = inviteFromRow({ id: "i", game_id: "g", from_user: "a", to_user: "b", from_name: "Ana", join_code: "ABCDEF", status: "declined", created_at: new Date(NOW).toISOString() });
    expect(i).toMatchObject({ status: "declined", boardName: null, fromAvatar: null, createdAt: NOW });
    expect(formatFriendCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(normalizeFriendCode(" abcd-efgh ")).toBe("ABCDEFGH");
  });
});

describe("docs/phase13.md §4 invite toasts", () => {
  it("toasts a fresh pending invite once, replaces one for the same game, caps the stack, and folds away after the visible window", () => {
    let s = toastReducer(EMPTY_TOASTS, { type: "receive", invite: invite("a"), me: "me", now: NOW });
    expect(s.toasts.map((t) => t.invite.id)).toEqual(["a"]);
    expect(toastReducer(s, { type: "receive", invite: invite("a"), me: "me", now: NOW })).toBe(s);
    s = toastReducer(s, { type: "receive", invite: invite("b"), me: "me", now: NOW + 1 });
    expect(s.toasts.map((t) => t.invite.id)).toEqual(["b"]);
    for (const id of ["c", "d", "e", "f"]) s = toastReducer(s, { type: "receive", invite: invite(id, { gameId: id }), me: "me", now: NOW + 2 });
    expect(s.toasts).toHaveLength(MAX_TOASTS);
    expect(s.toasts.map((t) => t.invite.id)).toEqual(["d", "e", "f"]);
    s = toastReducer(s, { type: "dismiss", id: "e" });
    expect(s.toasts.map((t) => t.invite.id)).toEqual(["d", "f"]);
    expect(toastReducer(s, { type: "tick", now: NOW + 2 + TOAST_VISIBLE_MS - 1 }).toasts).toHaveLength(2);
    expect(toastReducer(s, { type: "tick", now: NOW + 2 + TOAST_VISIBLE_MS }).toasts).toHaveLength(0);
  });

  it("ignores invites for others, settled ones and lapsed ones, and drops toasts settled elsewhere", () => {
    expect(toastReducer(EMPTY_TOASTS, { type: "receive", invite: invite("x", { toUser: "ben" }), me: "me", now: NOW }).toasts).toHaveLength(0);
    expect(toastReducer(EMPTY_TOASTS, { type: "receive", invite: invite("x", { status: "declined" }), me: "me", now: NOW }).toasts).toHaveLength(0);
    const lapsed = toastReducer(EMPTY_TOASTS, { type: "receive", invite: invite("x", { createdAt: NOW - INVITE_TTL_MS - 1 }), me: "me", now: NOW });
    expect(lapsed.toasts).toHaveLength(0);
    expect(lapsed.seen).toEqual(["x"]);
    const s = toastReducer(EMPTY_TOASTS, { type: "receive", invite: invite("y"), me: "me", now: NOW });
    expect(toastReducer(s, { type: "sync", invites: [invite("y", { status: "accepted" })] }).toasts).toHaveLength(0);
    expect(toastReducer(s, { type: "sync", invites: [invite("y")] })).toBe(s);
    expect(openInvites([invite("o1", { createdAt: NOW - 5 }), invite("o2"), invite("o3", { status: "expired" }), invite("o4", { toUser: "ben" }), invite("o5", { createdAt: NOW - INVITE_TTL_MS - 1 })], "me", NOW).map((i) => i.id)).toEqual(["o2", "o1"]);
  });
});
