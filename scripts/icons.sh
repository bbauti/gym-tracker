#!/bin/sh
# Regenera los PNG de ícono/splash desde assets/icon-src/dumbbell.svg (necesita rsvg-convert: brew install librsvg).
set -e
cd "$(dirname "$0")/.."
SRC=assets/icon-src/dumbbell.svg
OUT=assets/images
GLYPH=$(sed -n '/<rect/p' "$SRC")
BG='<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A9DF5"/><stop offset="1" stop-color="#0A6FD6"/></linearGradient></defs>'
# ícono completo (1024): fondo + glifo al 62 % del ancho, centrado
render() { # $1 out, $2 size, $3 inner svg
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">%s</svg>' "$3" | rsvg-convert -w "$2" -h "$2" -o "$1"
}
glyph_at() { # $1 width in px of the 640-wide glyph, centered
  s=$(printf '%s' "$1 / 640" | bc -l); w=$1; h=$(printf '%s' "$1 / 2" | bc -l)
  printf '<g transform="translate(%s %s) scale(%s)" fill="#FFFFFF">%s</g>' "$(printf '%s' "(1024 - $w) / 2" | bc -l)" "$(printf '%s' "(1024 - $h) / 2" | bc -l)" "$s" "$GLYPH"
}
render "$OUT/icon.png" 1024 "$BG<rect width=\"1024\" height=\"1024\" fill=\"url(#g)\"/>$(glyph_at 640)"
render "$OUT/android-icon-background.png" 1024 "$BG<rect width=\"1024\" height=\"1024\" fill=\"url(#g)\"/>"
render "$OUT/android-icon-foreground.png" 1024 "$(glyph_at 520)"
render "$OUT/android-icon-monochrome.png" 1024 "$(glyph_at 520)"
render "$OUT/splash-icon.png" 400 "$(glyph_at 900)"
render "$OUT/favicon.png" 48 "$BG<rect width=\"1024\" height=\"1024\" rx=\"220\" fill=\"url(#g)\"/>$(glyph_at 640)"
cp "$SRC" assets/expo.icon/Assets/dumbbell.svg
echo done
