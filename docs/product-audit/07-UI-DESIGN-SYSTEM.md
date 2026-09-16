# 07 — UI DESIGN SYSTEM

Status: NOT STARTED — Phase 5. What exists (confirmed in `styles/theme.css` and `components/ui/Primitives.tsx`):
- Tokens as CSS variables (`--bg`, `--card`, `--card-2/3`, `--separator(-strong)`, `--label(-2/-3/-4)`, `--accent(-press/-tint/-tint-2)`, `--brand-yellow*`, ageing ramp `--age-1..4` with `-bg`/`-ink`, `--pos/--warn/--dang` with `-bg`, radii, shadows `--e1..3`), exposed to Tailwind via `@theme inline`.
- A palette remap so legacy `gray/blue/emerald/amber/red/rose-*` utilities resolve to the tokens.
- Primitives: Button (primary/secondary/ghost/danger/quiet × sm/md/lg), Badge (9 tones), Card, SectionHeader, Money, AgeingBar/Legend, Stat, EmptyState, SkeletonRows, LoadingList, Spinner.
- `.label` and `.num` utility classes; `animate-reveal` keyframe; native controls follow `data-theme`.
- Dead utility classes referenced in code: `animate-in slide-in-from-* fade-in duration-150` (from a plugin that is not installed) in the LiveStockView drawer and the AppShell sheet — no effect; to be replaced or removed (Phase 9).
