# App icons

`public/manifest.webmanifest` references the icons below. All three PNGs are
**committed** here, so a production build is installable with a real home-screen
icon. Regenerate them from the master (`icon.svg` / `icon-1024.png`) if the brand
mark changes — see "Generating them" below.

| File                | Size      | `purpose` | Notes                                              |
| ------------------- | --------- | --------- | -------------------------------------------------- |
| `icon-192.png`      | 192 × 192 | `any`     | Standard PWA icon.                                 |
| `icon-512.png`      | 512 × 512 | `any`     | Standard PWA icon / splash source.                 |
| `maskable-512.png`  | 512 × 512 | `maskable`| Logo sits inside the inner 80% "safe zone".        |

Source master: `icon.svg` (editable vector) and `icon-1024.png` (rendered 1024²).

## Art direction

Match the BASECAMP look (see `design-prototypes/variant-4-basecamp/index.html`):

- Background `#1c1a17` (matches `theme_color` / `background_color`).
- Blaze→gold gradient mark: `linear-gradient(135deg, #c8622d, #d9a441)`.
- A mountain/summit glyph reads well at small sizes.

## Generating them

The committed icons were built with ImageMagick from `icon.svg`.

> **Gotcha:** ImageMagick only renders SVG `<linearGradient>` fills when an SVG
> delegate such as `rsvg-convert` is installed. Without it, IM's built-in reader
> drops the gradient and the mark renders **black**. The recipe below sidesteps
> that by building the blaze→gold gradient natively in IM (works with no extra
> delegates) and using the mountain shape as a mask.

```bash
# 1) Native 135° blaze→gold gradient (no rsvg-convert needed)
magick -size 1024x1024 xc: \
  -sparse-color barycentric "0,0 #c8622d 1023,1023 #d9a441" grad.png
# 2) Mountain ridge mask + snow-cap mask (drawn natively)
magick -size 1024x1024 xc:black -fill white \
  -draw "polygon 172,744 420,392 536,536 660,336 852,744" mask.png
magick -size 1024x1024 xc:black -fill white \
  -draw "polygon 420,392 480,480 420,452 364,488" \
  -draw "polygon 660,336 720,464 660,432 604,468" caps.png
# 3) Compose gradient through the mask onto the bg, cut the snow caps back to bg
magick -size 1024x1024 xc:'#1c1a17' \
  \( grad.png mask.png -alpha off -compose CopyOpacity -composite \) -composite \
  \( -size 1024x1024 xc:'#1c1a17' caps.png -alpha off -compose CopyOpacity -composite \) -composite \
  -alpha remove -alpha off -flatten icon-1024.png

# Export the three referenced sizes (flattened on the bg, opaque, 8-bit)
magick icon-1024.png -resize 192x192 -background "#1c1a17" -alpha remove \
  -type TrueColor -depth 8 -strip icon-192.png
magick icon-1024.png -resize 512x512 -background "#1c1a17" -alpha remove \
  -type TrueColor -depth 8 -strip icon-512.png
# maskable: shrink art to ~80% (410px), centre on the bg, flatten
magick icon-1024.png -resize 410x410 -background "#1c1a17" -gravity center \
  -extent 512x512 -alpha remove -type TrueColor -depth 8 -strip maskable-512.png
```

If you have `rsvg-convert` (or another SVG renderer) installed, you can instead
edit `icon.svg` and render the 1024² master directly
(`magick -background none -density 384 icon.svg -resize 1024x1024 icon-1024.png`),
then run only the three export commands above.
