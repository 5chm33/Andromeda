/**
 * Andromeda ThemeEngine v7.4.0
 * Dynamic background skin registry with persistent selection.
 * 8 cinematic skins with skin-aware accent color theming.
 */

export type SkinId =
  | "aurora"
  | "goth"
  | "nature"
  | "cyberpunk"
  | "finalfantasy"
  | "monsters"
  | "lofi"
  | "spacestation";

export interface SkinMeta {
  id: SkinId;
  name: string;
  description: string;
  /** Primary OKLCH accent color for CSS variable injection */
  accent: string;
  /** Preview gradient shown in the selector tile */
  previewGradient: string;
  /** Tile label color */
  labelColor: string;
}

export const SKINS: SkinMeta[] = [
  {
    id: "aurora",
    name: "Aurora",
    description: "Deep star field with layered aurora curtains, nebula wisps, and shooting stars",
    accent: "oklch(0.62 0.22 265)",
    previewGradient: "linear-gradient(135deg, #020008 0%, #06041a 50%, #0a0820 100%)",
    labelColor: "#a78bfa",
  },
  {
    id: "goth",
    name: "Goth",
    description: "Cologne Cathedral silhouette, full moon, flocking bats, and purple ground mist",
    accent: "oklch(0.55 0.18 320)",
    previewGradient: "linear-gradient(135deg, #020005 0%, #0a0015 50%, #080010 100%)",
    labelColor: "#c084fc",
  },
  {
    id: "nature",
    name: "Jungle",
    description: "Rope bridge over canyon, waterfall, light shafts, tropical birds, and bioluminescent glow",
    accent: "oklch(0.65 0.20 145)",
    previewGradient: "linear-gradient(135deg, #020c04 0%, #041508 50%, #030d05 100%)",
    labelColor: "#86efac",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    description: "Neon rain city, anime skyline, wet street reflections, flying cars, and neon signs",
    accent: "oklch(0.72 0.25 195)",
    previewGradient: "linear-gradient(135deg, #020308 0%, #05080f 50%, #080c18 100%)",
    labelColor: "#67e8f9",
  },
  {
    id: "finalfantasy",
    name: "Final Fantasy",
    description: "Cloud, Vivi, Tifa, Moogle, Chocobo, and Bahamut shadow with summon magic circles",
    accent: "oklch(0.75 0.22 55)",
    previewGradient: "linear-gradient(135deg, #040210 0%, #080420 50%, #060220 100%)",
    labelColor: "#fde68a",
  },
  {
    id: "monsters",
    name: "Monsters Inc",
    description: "Sulley, Mike, Boo, Kevin the bird, and grandpa parade with Up balloon house",
    accent: "oklch(0.68 0.22 240)",
    previewGradient: "linear-gradient(135deg, #0a0c18 0%, #0c1020 50%, #060810 100%)",
    labelColor: "#93c5fd",
  },
  {
    id: "lofi",
    name: "Lo-Fi Night",
    description: "Anime girl at window, glowing cat, crescent moon, city skyline, and rain on glass",
    accent: "oklch(0.70 0.18 30)",
    previewGradient: "linear-gradient(135deg, #08050f 0%, #0f0a1a 50%, #0a0810 100%)",
    labelColor: "#fca5a5",
  },
  {
    id: "spacestation",
    name: "Space Station",
    description: "Galaxy viewport, floating objects, purple/teal neon glow, and perspective floor grid",
    accent: "oklch(0.65 0.25 280)",
    previewGradient: "linear-gradient(135deg, #02000a 0%, #05020f 50%, #040210 100%)",
    labelColor: "#c4b5fd",
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

/** Apply skin-aware accent color to CSS custom properties */
export function applySkinAccent(id: SkinId): void {
  const skin = SKINS.find((s) => s.id === id);
  if (!skin) return;
  try {
    document.documentElement.style.setProperty("--primary", skin.accent);
  } catch { /* ignore */ }
}
