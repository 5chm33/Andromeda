/**
 * Andromeda ThemeEngine v7.3.0
 * Dynamic background skin registry with persistent selection.
 */

export type SkinId =
  | "aurora"
  | "goth"
  | "nature"
  | "cyberpunk"
  | "finalfantasy"
  | "monsters";

export interface SkinMeta {
  id: SkinId;
  name: string;
  description: string;
  /** Emoji used in the selector tile */
  icon: string;
  /** Dominant accent color for the selector tile border */
  accent: string;
  /** Preview gradient shown in the selector tile */
  previewGradient: string;
}

export const SKINS: SkinMeta[] = [
  {
    id: "aurora",
    name: "Aurora",
    description: "Soft violet & indigo aurora blobs drifting across a deep space backdrop",
    icon: "🌌",
    accent: "oklch(0.62 0.22 265)",
    previewGradient: "linear-gradient(135deg, #0d0820 0%, #1a0a3d 50%, #0a1628 100%)",
  },
  {
    id: "goth",
    name: "Goth / Tarot",
    description: "Flickering candles, drifting tarot cards, and a moonlit altar",
    icon: "🕯️",
    accent: "oklch(0.55 0.18 320)",
    previewGradient: "linear-gradient(135deg, #0a0008 0%, #1a0020 50%, #080010 100%)",
  },
  {
    id: "nature",
    name: "Enchanted Forest",
    description: "Fireflies, falling leaves, and bioluminescent mushrooms in a night forest",
    icon: "🌿",
    accent: "oklch(0.65 0.20 145)",
    previewGradient: "linear-gradient(135deg, #020d04 0%, #041a08 50%, #010804 100%)",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    description: "Rain-soaked neon streets, glitch scanlines, and holographic data streams",
    icon: "⚡",
    accent: "oklch(0.72 0.25 195)",
    previewGradient: "linear-gradient(135deg, #000d0d 0%, #001a1a 50%, #0d0020 100%)",
  },
  {
    id: "finalfantasy",
    name: "Final Fantasy",
    description: "Moogle, Vivi, Taru, Mithra and iconic FF summon magic swirling across the screen",
    icon: "⚔️",
    accent: "oklch(0.75 0.22 55)",
    previewGradient: "linear-gradient(135deg, #0a0818 0%, #180a28 50%, #080418 100%)",
  },
  {
    id: "monsters",
    name: "Monsters Inc",
    description: "Adorable monsters peeking, bouncing, and sneaking across the screen",
    icon: "👾",
    accent: "oklch(0.68 0.22 240)",
    previewGradient: "linear-gradient(135deg, #060a18 0%, #0a1428 50%, #040810 100%)",
  },
];

const STORAGE_KEY = "andromeda_skin";

export function getSavedSkin(): SkinId {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as SkinId | null;
    if (v && SKINS.find((s) => s.id === v)) return v;
  } catch { /* ignore */ }
  return "aurora";
}

export function saveSkin(id: SkinId): void {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
}
