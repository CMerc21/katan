"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { avatarFromSeed, type AvatarSpec } from "@katan/avatars";
import { generateBotNames, type BotLevel } from "@katan/bots";
import { PLAYER_COLORS, createRng } from "@katan/engine";
import { AvatarPicker } from "@/components/AvatarPicker";
import { BoardPicker, choiceDefinition, choiceForGame, type BoardChoice } from "@/components/BoardPicker";
import { Button } from "@/components/ui";
import { startHotseat } from "@/game/store";
import { useSession } from "@/hooks/useSession";

const DEFAULT_NAMES = ["Ada", "Bo", "Cy", "Di", "Eve", "Fay"];
const MAX_SEATS = DEFAULT_NAMES.length;
type SeatKind = "human" | BotLevel;

function randomSeed(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** Start a hotseat game on this device (docs/phase3.md §3.1); seats may be bots with medieval names and portraits (docs/phase7.md §4–§5). */
export function HotseatStart() {
  const router = useRouter();
  const { session } = useSession();
  const [count, setCount] = useState<number>(4);
  const [seed, setSeed] = useState<string>(() => randomSeed());
  const botNames = useMemo(() => {
    const r = createRng(seed, "bot-names");
    return generateBotNames(() => r.next(), MAX_SEATS, DEFAULT_NAMES);
  }, [seed]);
  const [names, setNames] = useState<string[]>(DEFAULT_NAMES);
  const [touched, setTouched] = useState<boolean[]>(() => DEFAULT_NAMES.map(() => false));
  const [kinds, setKinds] = useState<SeatKind[]>(() => DEFAULT_NAMES.map(() => "human" as const));
  const [avatars, setAvatars] = useState<AvatarSpec[]>(() => DEFAULT_NAMES.map((n, i) => avatarFromSeed(`hotseat:${n}:${i}`)));
  const [board, setBoard] = useState<BoardChoice>({ kind: "builtin", id: "beginner" });
  const [problem, setProblem] = useState<string | null>(null);
  const seatCap = Math.min(MAX_SEATS, choiceDefinition(board).seats.max);
  const seats = Math.min(count, seatCap);
  const isBeginner = board.kind === "builtin" && board.id === "beginner";

  const shownName = (i: number) => (kinds[i] !== "human" && !touched[i] ? (botNames[i] ?? names[i] ?? "") : (names[i] ?? ""));

  const start = () => {
    const chosen = Array.from({ length: seats }, (_, i) => shownName(i).trim());
    if (chosen.some((n) => n.length === 0)) return setProblem("Every player needs a name.");
    if (new Set(chosen.map((n) => n.toLowerCase())).size !== chosen.length) return setProblem("Player names must differ.");
    setProblem(null);
    const players = chosen.map((name, i) => {
      const id = `p${i + 1}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const kind = kinds[i] ?? "human";
      const avatar = avatars[i]!;
      return kind === "human" ? { id, name, avatar } : { id, name, bot: kind, avatar };
    });
    startHotseat({ players, board: choiceForGame(board), seed: isBeginner ? "beginner" : seed.trim() || randomSeed() });
    router.push("/play");
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        start();
      }}
    >
      <fieldset>
        <legend className="font-display text-base font-semibold">Players</legend>
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Player count">
          {Array.from({ length: seatCap - 2 }, (_, i) => i + 3).map((n) => (
            <Button key={n} variant={seats === n ? "primary" : "secondary"} role="radio" aria-checked={seats === n} onClick={() => setCount(n)} data-testid={`count-${n}`}>
              {n} players
            </Button>
          ))}
        </div>
        <ol className="mt-3 space-y-3">
          {Array.from({ length: seats }, (_, i) => (
            <li key={i} className="flex flex-wrap items-center gap-3">
              <AvatarPicker spec={avatars[i]!} color={PLAYER_COLORS[i]!} name={shownName(i)} compact onChange={(spec) => setAvatars(avatars.map((a, j) => (j === i ? spec : a)))} size={44} />
              <label className="sr-only" htmlFor={`name-${i}`}>
                Player {i + 1} name
              </label>
              <input
                id={`name-${i}`}
                data-testid={`name-${i}`}
                className="min-w-0 flex-1 rounded-md border border-line bg-white/60 px-3 py-1.5"
                value={shownName(i)}
                maxLength={24}
                onChange={(e) => {
                  setNames(names.map((n, j) => (j === i ? e.target.value : n)));
                  setTouched(touched.map((t, j) => (j === i ? true : t)));
                }}
              />
              <label className="sr-only" htmlFor={`kind-${i}`}>
                Player {i + 1} kind
              </label>
              <select
                id={`kind-${i}`}
                data-testid={`kind-${i}`}
                className="rounded-md border border-line bg-white/60 px-2 py-1.5 text-sm"
                value={kinds[i]}
                onChange={(e) => setKinds(kinds.map((k, j) => (j === i ? (e.target.value as SeatKind) : k)))}
              >
                <option value="human">Human</option>
                <option value="easy">Bot (easy)</option>
                <option value="medium">Bot (medium)</option>
                <option value="hard">Bot (hard)</option>
              </select>
            </li>
          ))}
        </ol>
      </fieldset>

      <fieldset>
        <legend className="font-display text-base font-semibold">Board</legend>
        <div className="mt-2">
          <BoardPicker value={board} onChange={setBoard} signedIn={session !== null} />
        </div>
        {!isBeginner && (
          <div className="mt-3 flex items-center gap-3">
            <label htmlFor="seed" className="text-sm">
              Seed
            </label>
            <input id="seed" className="w-40 rounded-md border border-line bg-white/60 px-3 py-1.5 font-mono" value={seed} onChange={(e) => setSeed(e.target.value)} />
            <Button size="sm" variant="quiet" onClick={() => setSeed(randomSeed())}>
              New seed
            </Button>
          </div>
        )}
      </fieldset>

      {problem && (
        <p className="text-sm text-clay" role="alert">
          {problem}
        </p>
      )}

      <Button type="submit" variant="primary" className="px-6 py-2.5 text-lg" data-testid="start">
        Start game
      </Button>
    </form>
  );
}
