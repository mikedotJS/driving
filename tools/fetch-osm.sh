#!/usr/bin/env bash
# Télécharge les données OpenStreetMap brutes (API officielle, découpage en tuiles)
# pour la zone Montreuil / Paris 20e. Sortie : data/osm-raw/tile_<col>_<row>.osm
# Données © les contributeurs d'OpenStreetMap, licence ODbL.
set -u
OUT="$(dirname "$0")/../data/osm-raw"
mkdir -p "$OUT"
LON0=${LON0:-2.4050}; LON1=${LON1:-2.4480}
LAT0=${LAT0:-48.8500}; LAT1=${LAT1:-48.8660}
DLON=${DLON:-0.0075}; DLAT=${DLAT:-0.0040}
UA="driving-sim-map-builder/0.1"
col=0
lon=$LON0
while awk "BEGIN{exit !($lon < $LON1 - 1e-9)}"; do
  lon2=$(awk "BEGIN{v=$lon+$DLON; if (v>$LON1) v=$LON1; printf \"%.4f\", v}")
  row=0
  lat=$LAT0
  while awk "BEGIN{exit !($lat < $LAT1 - 1e-9)}"; do
    lat2=$(awk "BEGIN{v=$lat+$DLAT; if (v>$LAT1) v=$LAT1; printf \"%.4f\", v}")
    f="$OUT/tile_${col}_${row}.osm"
    if [ ! -s "$f" ] || ! tail -c 20 "$f" | grep -q "</osm>"; then
      for try in 1 2 3 4; do
        code=$(curl -sS -m 180 -A "$UA" -o "$f.tmp" -w "%{http_code}" \
          "https://api.openstreetmap.org/api/0.6/map?bbox=${lon},${lat},${lon2},${lat2}")
        if [ "$code" = "200" ] && tail -c 20 "$f.tmp" | grep -q "</osm>"; then
          mv "$f.tmp" "$f"; break
        fi
        echo "  retry $try (http $code) tile ${col}_${row}: $(head -c 200 "$f.tmp" 2>/dev/null)" >&2
        sleep $((try * 4))
      done
      sleep 1
    fi
    echo "tile ${col}_${row} bbox=${lon},${lat},${lon2},${lat2} size=$(stat -c %s "$f" 2>/dev/null || echo MISSING)"
    lat=$lat2; row=$((row+1))
  done
  lon=$lon2; col=$((col+1))
done
