"use client";

import Link from "next/link";
import { HotseatStart } from "@/components/HotseatStart";

/** Hotseat on one device: the fastest way to test the rules (docs/phase4.md §7). */
export default function HotseatPage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-3xl font-semibold">Hotseat</h1>
      <p className="mt-1 text-ink-soft">Everyone shares this screen. Seats can be bots.</p>
      <div className="mt-8">
        <HotseatStart />
      </div>
      <p className="mt-8 text-sm text-ink-soft">
        <Link className="underline" href="/">
          Back to online play
        </Link>
      </p>
    </main>
  );
}
