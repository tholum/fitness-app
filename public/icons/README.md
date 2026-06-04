# App icons (placeholder)

`public/manifest.webmanifest` references the icons below. They are **not yet
committed** — add the real PNGs here before shipping a production PWA build, or
the install prompt / home-screen icon will be missing.

| File                | Size      | `purpose` | Notes                                              |
| ------------------- | --------- | --------- | -------------------------------------------------- |
| `icon-192.png`      | 192 × 192 | `any`     | Standard PWA icon.                                 |
| `icon-512.png`      | 512 × 512 | `any`     | Standard PWA icon / splash source.                 |
| `maskable-512.png`  | 512 × 512 | `maskable`| Keep the logo inside the inner 80% "safe zone".    |

## Art direction

Match the BASECAMP look (see `design-prototypes/variant-4-basecamp/index.html`):

- Background `#1c1a17` (matches `theme_color` / `background_color`).
- Blaze→gold gradient mark: `linear-gradient(135deg, #c8622d, #d9a441)`.
- A mountain/summit glyph reads well at small sizes.

## Generating them

Drop a single square master (e.g. `icon.svg` or a 1024px PNG) here, then export
the three sizes with any tool you like, for example:

```bash
# requires ImageMagick
magick icon-1024.png -resize 192x192 icon-192.png
magick icon-1024.png -resize 512x512 icon-512.png
# maskable: pad the art into the safe zone, then flatten on the bg color
magick icon-1024.png -resize 410x410 -background "#1c1a17" -gravity center \
  -extent 512x512 maskable-512.png
```

Until these exist the app still runs; only the installable-PWA icon is affected.
