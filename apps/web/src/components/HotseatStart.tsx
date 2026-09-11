"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BotLevel } from "@katan/bots";
import { PLAYER_COLORS, type BoardKind } from "@katan/engine";
import { Button, Swatch } from "@/components/ui";
import { startHotseat } from "@/game/store";

const DEFAULT_NAMES = ["Ada", "Bo", "Cy", "Di"];
type SeatKind = "human" | BotLevel;

function randomSeed(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** Start a hotseat game on this device (docs/phase3.md §3.1); seats may be bots (docs/phase5.md §6.2). */
export function HotseatStart() {
  const router = useRouter();
  const [count, setCount] = useState<3 | 4>(4);
  const [names, setNames] = useState<string[]>(DEFAULT_NAMES);
  const [kinds, setKinds] = useState<SeatKind[]>(["human", "human", "human", "human"]);
  const [board, setBoard] = useState<BoardKind>("beginner");
  const [seed, setSeed] = useState<string>(() => randomSeed());
  const [problem, setProblem] = useState<string | null>(null);

  const start = () => {
    const chosen = names.slice(0, count).map((n) => n.trim());
    if (chosen.some((n) => n.length === 0)) return setProblem("Every player needs a name.");
    if (new Set(chosen.map((n) => n.toLowerCase())).size !== chosen.length) return setProblem("Player names must differ.");
    if (kinds.slice(0, count).every((k) => k !== "human")) setProblem(null);
    const players = chosen.map((name, i) => {
      const id = `p${i + 1}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const kind = kinds[i] ?? "human";
      return kind === "human" ? { id, name } : { id, name, bot: kind };
    });
    startHotseat({ players, board, seed: board === "random" ? seed.trim() || randomSeed() : "beginner" });
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
        <legend className="text-sm font-semibold">Players</legend>
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Player count">
          {([3, 4] as const).map((n) => (
            <Button key={n} variant={count === n ? "primary" : "secondary"} role="radio" aria-checked={count === n} onClick={() => setCount(n)} data-testid={`count-${n}`}>
              {n} players
            </Button>
          ))}
        </div>
        <ol className="mt-3 space-y-2">
          {names.slice(0, count).map((name, i) => (
            <li key={i} className="flex items-center gap-3">
              <Swatch color={PLAYER_COLORS[i]!} size={18} />
              <label className="sr-only" htmlFor={`name-${i}`}>
                Player {i + 1} name
              </label>
              <input
                id={`name-${i}`}
                data-testid={`name-${i}`}
                className="w-full rounded-md border border-line bg-white/60 px-3 py-1.5"
                value={name}
                maxLength={20}
                onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))}
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
        <legend className="text-sm font-semibold">Board</legend>
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Board">
          <Button variant={board === "beginner" ? "primary" : "secondary"} role="radio" aria-checked={board === "beginner"} onClick={() => setBoard("beginner")} data-testid="board-beginner">
            Beginner
          </Button>
          <Button variant={board === "random" ? "primary" : "secondary"} role="radio" aria-checked={board === "random"} onClick={() => setBoard("random")} data-testid="board-random">
            Random
          </Button>
        </div>
        {board === "random" && (
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
