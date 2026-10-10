# Deck tokens

From `deck/index.html`.

## Colors

```css
--bg: #142028;
--bg-soft: #1b2830;
--paper: #f6f1e7;
--ink: #f6f1e7;
--ink-soft: rgba(246, 241, 231, 0.78);
--ink-faint: rgba(246, 241, 231, 0.45);
--vermilion: #c2410c;
--orange: #e07a2f;
--glass: rgba(246, 241, 231, 0.06);
--glass-line: rgba(246, 241, 231, 0.14);
--warn: #fbbf24;
```

## Type

Typography is not stored as CSS variables. It is set on `body`:

```css
font: 400 26px/1.35 "Outfit", "Avenir Next", "Segoe UI", sans-serif;
letter-spacing: -0.01em;
```

Outfit is loaded at weights 400, 500, and 600.

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Display (`.big`) | 172px | 300 | −0.055em |
| `h1` | 104px | 400 | −0.035em |
| `h2` | 72px | 400 | −0.035em |
| Lede | 32px | 400 | — |
| `h3` | 30px | 500 | −0.02em |
| Body | 26px | 400 | −0.01em |
| Small | 21px | 400 | — |
| Eyebrow | 14–15px | 600 | 0.14–0.16em, uppercase |
