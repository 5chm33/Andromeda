/**
 * Andromeda ThemeEngine v8.0.0
 * Real AI-generated background images + video loops.
 * 10 cinematic skins — no canvas emoji art.
 */

export type SkinId =
  | "andromeda"
  | "andromeda2"
  | "aurora"
  | "goth"
  | "nature"
  | "cyberpunk"
  | "finalfantasy"
  | "monsters"
  | "lofi"
  | "spacestation"
  | "luigismansion"
  | "stealth";

export interface SkinMeta {
  id: SkinId;
  name: string;
  description: string;
  /** Path to the AI-generated background image in /public/skins/ */
  bgImage: string;
  /** Primary OKLCH accent color for CSS variable injection */
  accent: string;
  /** Overlay tint color (rgba) to darken/tint the image for readability */
  overlayColor: string;
  /** CSS animation class applied to the background for motion */
  animClass: string;
  /** Tile gradient for the skin selector */
  previewGradient: string;
  /** Label color for the selector tile */
  labelColor: string;
}

export const SKINS: SkinMeta[] = [
  {
    id: "andromeda",
    name: "Andromeda",
    description: "AI-generated cinematic space station — the home of Andromeda",
    bgImage: "/skins/andromeda.jpg",
    accent: "oklch(0.68 0.22 220)",
    overlayColor: "rgba(0,5,20,0.25)",
    animClass: "skin-andromeda",
    previewGradient: "linear-gradient(135deg, #000514 0%, #001028 50%, #000a1e 100%)",
    labelColor: "#38bdf8",
  },
  {
    id: "andromeda2",
    name: "Andromeda II",
    description: "AI-generated cinematic deep-space data rings — the neural core of Andromeda",
    bgImage: "/skins/andromeda2.jpg",
    accent: "oklch(0.65 0.25 210)",
    overlayColor: "rgba(0,3,18,0.22)",
    animClass: "skin-andromeda2",
    previewGradient: "linear-gradient(135deg, #000312 0%, #000820 50%, #00051a 100%)",
    labelColor: "#22d3ee",
  },
  {
    id: "aurora",
    name: "Aurora",
    description: "Northern lights over a frozen arctic lake with star reflections",
    bgImage: "/skins/aurora.jpg",
    accent: "oklch(0.62 0.22 165)",
    overlayColor: "rgba(2,0,8,0.35)",
    animClass: "skin-aurora",
    previewGradient: "linear-gradient(135deg, #020c08 0%, #041510 50%, #030d08 100%)",
    labelColor: "#6ee7b7",
  },
  {
    id: "goth",
    name: "Goth",
    description: "Cologne Cathedral at night, full moon, bats, and purple mist",
    bgImage: "/skins/goth.jpg",
    accent: "oklch(0.55 0.18 320)",
    overlayColor: "rgba(5,0,15,0.40)",
    animClass: "skin-goth",
    previewGradient: "linear-gradient(135deg, #020005 0%, #0a0015 50%, #080010 100%)",
    labelColor: "#c084fc",
  },
  {
    id: "nature",
    name: "Forest",
    description: "Ancient rainforest at golden hour with deer, ferns, and bioluminescent mushrooms",
    bgImage: "/skins/nature_forest.jpg",
    accent: "oklch(0.65 0.20 145)",
    overlayColor: "rgba(2,8,2,0.30)",
    animClass: "skin-nature",
    previewGradient: "linear-gradient(135deg, #020c04 0%, #041508 50%, #030d05 100%)",
    labelColor: "#86efac",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    description: "Blade Runner neon megacity in rain with flying cars and holographic signs",
    bgImage: "/skins/cyberpunk.jpg",
    accent: "oklch(0.72 0.25 195)",
    overlayColor: "rgba(2,3,12,0.35)",
    animClass: "skin-cyberpunk",
    previewGradient: "linear-gradient(135deg, #020308 0%, #05080f 50%, #080c18 100%)",
    labelColor: "#67e8f9",
  },
  {
    id: "finalfantasy",
    name: "Final Fantasy",
    description: "Crystal sky islands, ancient airship, chocobo and moogle at twilight",
    bgImage: "/skins/finalfantasy.jpg",
    accent: "oklch(0.75 0.22 55)",
    overlayColor: "rgba(4,2,16,0.30)",
    animClass: "skin-finalfantasy",
    previewGradient: "linear-gradient(135deg, #040210 0%, #080420 50%, #060220 100%)",
    labelColor: "#fde68a",
  },
  {
    id: "monsters",
    name: "Monsters Inc",
    description: "The Monsters Inc scare floor with Boo's door and Sulley silhouette",
    bgImage: "/skins/monsters.jpg",
    accent: "oklch(0.68 0.22 240)",
    overlayColor: "rgba(5,8,20,0.35)",
    animClass: "skin-monsters",
    previewGradient: "linear-gradient(135deg, #0a0c18 0%, #0c1020 50%, #060810 100%)",
    labelColor: "#93c5fd",
  },
  {
    id: "lofi",
    name: "Lo-Fi Night",
    description: "Anime girl at desk with headphones, sleeping cat, rainy Japanese city outside",
    bgImage: "/skins/lofi.jpg",
    accent: "oklch(0.70 0.18 30)",
    overlayColor: "rgba(8,5,15,0.25)",
    animClass: "skin-lofi",
    previewGradient: "linear-gradient(135deg, #08050f 0%, #0f0a1a 50%, #0a0810 100%)",
    labelColor: "#fca5a5",
  },
  {
    id: "spacestation",
    name: "Space Station",
    description: "Space station viewport looking out at a nebula with Earth's horizon below",
    bgImage: "/skins/space.jpg",
    accent: "oklch(0.65 0.25 280)",
    overlayColor: "rgba(2,0,10,0.30)",
    animClass: "skin-space",
    previewGradient: "linear-gradient(135deg, #02000a 0%, #05020f 50%, #040210 100%)",
    labelColor: "#c4b5fd",
  },
  {
    id: "luigismansion",
    name: "Luigi's Mansion",
    description: "Luigi, Gooigi, King Boo and friends in the haunted foyer",
    bgImage: "/skins/luigis_mansion.jpg",
    accent: "oklch(0.65 0.22 145)",
    overlayColor: "rgba(0,8,5,0.28)",
    animClass: "skin-luigi",
    previewGradient: "linear-gradient(135deg, #000a05 0%, #001508 50%, #000d05 100%)",
    labelColor: "#4ade80",
  },
  {
    id: "stealth",
    name: "Stealth",
    description: "Clean minimal dark mode — pure black with subtle geometry",
    bgImage: "/skins/stealth.jpg",
    accent: "oklch(0.65 0.18 255)",
    overlayColor: "rgba(0,0,0,0.15)",
    animClass: "skin-stealth",
    previewGradient: "linear-gradient(135deg, #050505 0%, #0a0a0a 50%, #080808 100%)",
    labelColor: "#94a3b8",
  },
];

const STORAGE_KEY = "andromeda_skin";

export function getSavedSkin(): SkinId {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as SkinId | null;
    if (v && SKINS.find((s) => s.id === v)) return v;
  } catch { /* ignore */ }
  return "andromeda";
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
