"use client";

/**
 * Character customisation (docs/phase13.md §2): category tabs over the avatar
 * layers, a tile per option drawn with that option applied, the outfit colour,
 * shuffle. Every click equips at once; the showcase figure redraws behind the
 * panel, so there is no Save step.
 */

import { renderAvatar, renderFigure, type AvatarLayer } from "@katan/avatars";
import { PLAYER_COLORS } from "@katan/engine";
import { useMemo } from "react";
import { PARCHMENT_DEEP, PLAYER_FILL } from "@/game/theme";
import { ShuffleIcon } from "./icons";
import { CATEGORIES, equip, layerInfo, shuffle, withColor, withName, type CategoryKey, type Wardrobe } from "./wardrobe";

/** Body layers preview as a small figure, head layers as a portrait. */
const FIGURE_LAYERS: readonly AvatarLayer[] = ["garment", "accessory"];

function OptionTile({ wardrobe, layer, option, onPick }: { wardrobe: Wardrobe; layer: AvatarLayer; option: number; onPick: () => void }) {
  const info = layerInfo(layer);
  const selected = wardrobe.avatar[layer] === option;
  const html = useMemo(() => {
    const spec = { ...wardrobe.avatar, [layer]: option };
    const color = PLAYER_FILL[wardrobe.color];
    return FIGURE_LAYERS.includes(layer) ? renderFigure(spec, { color, height: 64, shadow: false, attrs: 'style="display:block;margin:auto"' }) : renderAvatar(spec, { color, background: PARCHMENT_DEEP, size: 56, attrs: 'style="display:block;margin:auto"' });
  }, [wardrobe.avatar, wardrobe.color, layer, option]);
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={info.options[option]}
      onClick={onPick}
      className={`flex flex-col items-center gap-1 rounded-lg border-2 px-1 pb-1 pt-1.5 text-[11px] leading-tight transition-colors ${selected ? "border-gilt bg-gilt/20" : "border-transparent bg-black/25 hover:border-gilt/50"}`}
      data-testid={`wardrobe-${layer}-${option}`}
    >
      <span className="block h-16 w-14 overflow-hidden" aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
      <span className="w-full truncate text-center">{info.options[option]}</span>
    </button>
  );
}

export function WardrobePanel({
  wardrobe,
  onChange,
  category,
  onCategory,
  onClose,
  guestName,
}: {
  wardrobe: Wardrobe;
  onChange: (next: Wardrobe) => void;
  category: CategoryKey;
  onCategory: (c: CategoryKey) => void;
  onClose: () => void;
  /** Guests name their character here; signed-in players use their account name. */
  guestName: boolean;
}) {
  const active = CATEGORIES.find((c) => c.key === category) ?? CATEGORIES[0]!;
  return (
    <section className="lb-plaque lb-sheet lb-sheet-right w-[min(24rem,calc(100vw-1.5rem))] p-4" aria-label="Wardrobe" data-testid="wardrobe">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-xl text-[#ffe9a8]">Wardrobe</h2>
        <button type="button" className="rounded px-2 text-2xl leading-none text-bone/70 hover:text-bone" aria-label="Close wardrobe" onClick={onClose} data-testid="wardrobe-close">
          ×
        </button>
      </header>
      <p className="mt-0.5 text-xs text-bone/70">Changes show on your character at once and come with you into every game.</p>

      <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Wardrobe categories">
        {CATEGORIES.map((c) => (
          <button key={c.key} type="button" role="tab" aria-selected={c.key === category} aria-checked={c.key === category} className="lb-dark px-2.5 py-1 text-xs" onClick={() => onCategory(c.key)} data-testid={`wardrobe-tab-${c.key}`}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-4" role="tabpanel" aria-label={active.label}>
        {active.colour && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-bone/80">Colour</h3>
            <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Outfit colour">
              {PLAYER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={wardrobe.color === c}
                  aria-label={c}
                  title={c}
                  onClick={() => onChange(withColor(wardrobe, c))}
                  className={`h-8 w-8 rounded-full border-2 ${wardrobe.color === c ? "border-gilt ring-2 ring-gilt/60" : "border-black/50"}`}
                  style={{ background: PLAYER_FILL[c] }}
                  data-testid={`wardrobe-color-${c}`}
                />
              ))}
            </div>
          </div>
        )}
        {active.layers.map((layer) => {
          const info = layerInfo(layer);
          return (
            <div key={layer}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-bone/80">{info.label}</h3>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                {info.options.map((_, i) => (
                  <OptionTile key={i} wardrobe={wardrobe} layer={layer} option={i} onPick={() => onChange(equip(wardrobe, layer, i))} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-gilt/25 pt-3">
        {guestName && (
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
            <span className="text-bone/80">Name</span>
            <input className="min-w-0 flex-1 rounded-md border border-gilt/40 bg-black/30 px-2 py-1 text-sm text-bone" maxLength={24} defaultValue={wardrobe.name} onBlur={(e) => onChange(withName(wardrobe, e.target.value))} data-testid="wardrobe-name" />
          </label>
        )}
        <button type="button" className="lb-dark flex items-center gap-1.5 px-3 py-1.5 text-sm" onClick={() => onChange(shuffle(wardrobe, Math.random))} data-testid="wardrobe-shuffle">
          <ShuffleIcon className="h-4 w-4" /> Shuffle
        </button>
        <button type="button" className="lb-gold ml-auto px-4 py-1.5 text-sm" onClick={onClose}>
          Done
        </button>
      </footer>
    </section>
  );
}
