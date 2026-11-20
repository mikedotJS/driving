#!/usr/bin/env bash
# Télécharge les ressources CC0 de Poly Haven (ciel HDRI, textures PBR) dans data/polyhaven,
# puis tools/prepare-assets.mjs les redimensionne vers public/textures.
set -u
OUT="$(dirname "$0")/../data/polyhaven"
mkdir -p "$OUT"
UA="driving-sim-asset-fetch/0.1"
get() { # url fichier
  if [ ! -s "$OUT/$2" ]; then
    curl -sS -m 300 -A "$UA" -o "$OUT/$2.tmp" "$1" && mv "$OUT/$2.tmp" "$OUT/$2" || echo "ECHEC $2" >&2
  fi
  echo "$2 $(stat -c %s "$OUT/$2" 2>/dev/null || echo MANQUANT)"
}
for sky in kloofendal_48d_partly_cloudy_puresky kloofendal_overcast_puresky; do
  get "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/${sky}_2k.hdr" "${sky}_2k.hdr"
done
for t in asphalt_02 asphalt_04 concrete_pavement cobblestone_floor_08 granite_tile painted_plaster_wall beige_wall_001 red_brick_03 concrete_wall_003 leafy_grass grey_roof_01 plastered_stone_wall; do
  for m in diff nor_gl arm; do
    get "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${t}/${t}_${m}_1k.jpg" "${t}_${m}.jpg"
  done
done
