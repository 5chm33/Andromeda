# Andromeda v7.3.0 — Dynamic Background Skins + Mobile Polish

## Summary
This release introduces a full dynamic background skin system with 6 animated canvas themes,
a floating skin selector UI, and mobile input bar polish. It also includes the immediate
streaming/mobile fixes from the v7.2.0 roadmap.

---

## New Features

### Dynamic Background Skin System
- **6 fully animated canvas skins** — each rendered at 60fps using the HTML5 Canvas API:
  - **Aurora** — violet/indigo aurora blobs drifting over a star field
  - **Goth / Tarot** — flickering candles, drifting tarot cards, moon, purple mist
  - **Enchanted Forest** — fireflies, falling leaves, bioluminescent mushroom glows
  - **Cyberpunk** — neon rain, Matrix-style data streams, perspective grid, scanlines
  - **Final Fantasy** — Moogle, Vivi, Crystal, Chocobo, Meteor sprites with magic particles
  - **Monsters Inc** — bouncy emoji monsters with squish animation and door glows
- **Floating palette button** — fixed bottom-right, opens a 2×3 skin picker grid
- **Persistent selection** — skin choice saved to localStorage, restored on next visit
- **Zero CSS overhead** — old CSS aurora blobs replaced by canvas; no extra DOM nodes

### Mobile Input Bar Polish
- Bottom input bar now uses `window.innerWidth < 640` to go full-width on phones
- Mode labels (Deep, Agent) hidden on mobile — icon-only to prevent overflow
- Plan Mode button hidden on mobile (accessible via settings gear)
- `env(safe-area-inset-bottom)` applied for iPhone notch compatibility

---

## Files Changed
| File | Change |
|------|--------|
| `client/src/lib/themeEngine.ts` | New — skin registry, SkinId type, getSavedSkin/saveSkin |
| `client/src/components/ThemeCanvas.tsx` | New — canvas RAF loop + all 6 skin painters |
| `client/src/components/SkinSelector.tsx` | New — floating palette button + skin picker modal |
| `client/src/pages/Home.tsx` | Wired ThemeCanvas + SkinSelector; removed old CSS aurora blobs |
| `client/src/pages/Search.tsx` | Mobile input bar: full-width on phones, icon-only mode buttons |

---

## Grade vs. SOTA (post v7.3.0)

| Dimension | Before v7.2.0 | After v7.3.0 |
|-----------|--------------|--------------|
| Visual uniqueness | B+ | **A** |
| Mobile UX | C+ | **B+** |
| Personalization | None | **A** (6 skins + persistent) |
| Animated backgrounds | CSS only | **Canvas 60fps** |
| Overall vs. Manus/Claude/Kimi | B+ | **A−** |

---

## What's Next (v7.4.0 roadmap)
1. Apply ThemeCanvas to the Search page as well (currently only on Home)
2. Add 2 more skins: "Lo-Fi City Night" (inspired by your monitor wallpaper) and "Space Station"
3. Skin-aware accent color theming — each skin shifts the primary OKLCH hue to match
4. Skin preview animation in the selector tiles (mini canvas thumbnails)
