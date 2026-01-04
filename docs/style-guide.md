# Lofiever Visual Style Guide (Draft)

Purpose
- Maintain a calm, long-session friendly interface.
- Use muted accents and avoid constant high-energy glow.

Core mood tokens (CSS variables)
- `--mood-bg-start`, `--mood-bg-end`: background gradient base
- `--mood-accent`: primary accent (CTAs, active states)
- `--mood-accent-2`: secondary accent (tabs, borders, subtle fills)
- `--mood-accent-3`: warm highlight (status, chips)
- `--mood-ring`: focus ring color

Mood presets
- Focus: slightly cooler, higher clarity
- Relax: balanced teal + plum + warm sand
- Sleep: darker, lower contrast, desaturated accents

Typography
- Body: Manrope (clean, neutral)
- Display/Headings: Fraunces (warm, editorial)

Do
- Keep backgrounds soft and low-contrast.
- Use motion for state changes only (playing, loading, alerts).
- Increase text contrast for long-reading areas (chat, playlist).

Avoid
- Full-screen glow or constant pulse across multiple components.
- Excessively saturated purple across all UI layers.
- Fixed heights that break smaller screens.
