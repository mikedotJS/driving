#!/usr/bin/env bash
# Télécharge les bâtiments de la BD TOPO de l'IGN (service WFS de la Géoplateforme, sans clé)
# pour la zone Montreuil / Paris 20e. Sortie : data/ign-raw/bat_<page>.json (GeoJSON, WGS84).
# Ils apportent à tools/build-map.mjs les hauteurs mesurées, les étages, les matériaux et les
# dates de construction ; les emprises restent celles d'OpenStreetMap.
# Données IGN – BD TOPO, Licence Ouverte Etalab 2.0.
set -u
OUT="$(dirname "$0")/../data/ign-raw"
mkdir -p "$OUT"
# même zone que fetch-osm.sh ; en EPSG:4326 le WFS 2.0 attend l'ordre latitude,longitude
LON0=${LON0:-2.4050}; LON1=${LON1:-2.4480}
LAT0=${LAT0:-48.8500}; LAT1=${LAT1:-48.8660}
COUNT=${COUNT:-2000}
UA="driving-sim-map-builder/0.1"
URL="https://data.geopf.fr/wfs/wfs"
BBOX="${LAT0},${LON0},${LAT1},${LON1},urn:ogc:def:crs:EPSG::4326"
page=0
start=0
while :; do
  f="$OUT/bat_${page}.json"
  # une page déjà complète n'est pas retéléchargée (un GeoJSON entier se termine par une accolade)
  if [ ! -s "$f" ] || ! tail -c 5 "$f" | grep -q "}"; then
    ok=0
    for try in 1 2 3 4; do
      # SORTBY=cleabs : sans tri stable, la pagination peut sauter ou répéter des bâtiments
      code=$(curl -sS -m 180 -A "$UA" -G -o "$f.tmp" -w "%{http_code}" "$URL" \
        --data-urlencode "SERVICE=WFS" --data-urlencode "VERSION=2.0.0" \
        --data-urlencode "REQUEST=GetFeature" --data-urlencode "TYPENAMES=BDTOPO_V3:batiment" \
        --data-urlencode "BBOX=${BBOX}" --data-urlencode "SORTBY=cleabs" \
        --data-urlencode "OUTPUTFORMAT=application/json" \
        --data-urlencode "COUNT=${COUNT}" --data-urlencode "STARTINDEX=${start}")
      if [ "$code" = "200" ] && grep -q '"FeatureCollection"' "$f.tmp" && tail -c 5 "$f.tmp" | grep -q "}"; then
        mv "$f.tmp" "$f"; ok=1; break
      fi
      echo "  retry $try (http $code) page ${page}: $(head -c 200 "$f.tmp" 2>/dev/null)" >&2
      sleep $((try * 4))
    done
    if [ "$ok" != "1" ]; then echo "échec page ${page}, abandon" >&2; rm -f "$f.tmp"; exit 1; fi
    sleep 1
  fi
  # le serveur annonce la page suivante par un lien rel=next ; son absence marque la dernière page
  n=$(grep -o '"numberReturned":[0-9]*' "$f" | head -1 | cut -d: -f2)
  echo "page ${page} start=${start} bâtiments=${n:-?} size=$(stat -c %s "$f")"
  if ! grep -q '"rel":"next"' "$f"; then break; fi
  page=$((page+1)); start=$((start+COUNT))
done
