#!/usr/bin/env python3
"""Relit, dans la base officielle LEGI (données ouvertes de la DILA), les articles du Code de la route
cités par le barème du jeu, et en extrait la classe de contravention, les points et la suspension.

usage : python3 -I tools/bareme/verifier-legi.py <dossier extrait contenant LEGITEXT000006074228>

La base se télécharge sur https://echanges.dila.gouv.fr/OPENDATA/LEGI/ (archive « Freemium_legi_global »,
1,2 Go) ; seul le dossier du Code de la route (LEGITEXT000006074228) est nécessaire.
"""
import os, re, sys, html
import xml.etree.ElementTree as ET

ARTICLES = ['R413-14', 'L413-1', 'R413-17', 'R413-19', 'R412-30', 'R412-31', 'R415-6', 'R415-7', 'R415-5',
            'R415-10', 'R415-4', 'R415-11', 'R415-2', 'R412-28', 'R412-9', 'R412-19', 'R412-7', 'R412-10',
            'R416-1', 'R412-12', 'R414-4', 'R417-11', 'R412-1', 'R416-11']
NOMBRES = {'un': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5, 'six': 6, 'huit': 8}
CLASSES = {'première': 1, 'deuxième': 2, 'troisième': 3, 'quatrième': 4, 'cinquième': 5}

root = sys.argv[1]
AUJOURDHUI = os.environ.get('DATE', '2026-11-20')
found = {}
for d, _, files in os.walk(root):
    for f in files:
        if not f.startswith('LEGIARTI') or not f.endswith('.xml'):
            continue
        p = os.path.join(d, f)
        try:
            t = ET.parse(p).getroot()
        except ET.ParseError:
            continue
        num = (t.findtext('.//META_ARTICLE/NUM') or '').strip()
        if num not in ARTICLES:
            continue
        # version applicable aujourd'hui (une version « abrogée en différé » reste en vigueur jusqu'à sa date de fin)
        debut = t.findtext('.//META_ARTICLE/DATE_DEBUT') or ''
        fin = t.findtext('.//META_ARTICLE/DATE_FIN') or ''
        if not (debut <= AUJOURDHUI < fin):
            continue
        c = t.find('.//BLOC_TEXTUEL/CONTENU')
        texte = html.unescape(re.sub(r'<[^>]+>', ' ', ET.tostring(c, encoding='unicode'))) if c is not None else ''
        texte = re.sub(r'\s+', ' ', texte).strip()
        if num not in found or debut > found[num][0]:
            found[num] = (debut, f[:-4], texte)

for num in ARTICLES:
    if num not in found:
        print(f'{num} | ABSENT de l\'extrait')
        continue
    debut, ident, texte = found[num]
    classes = sorted({CLASSES[m] for m in re.findall(r'contraventions? de la (\w+) classe', texte) if m in CLASSES} | {int(m) for m in re.findall(r'contraventions? de la (\d)e classe', texte)})
    points = sorted({NOMBRES[m] for m in re.findall(r'(?:réduction|retrait) de (\w+) points?', texte) if m in NOMBRES} | {int(m) for m in re.findall(r'réduction de (\d) points?', texte)} | ({1} if "réduction d'un point" in texte else set())
                    | {NOMBRES[m] for m in re.findall(r'de (\w+) points? du permis', texte) if m in NOMBRES})
    susp = 'suspension' in texte
    print(f'{num} | en vigueur depuis le {debut} | {ident} | classes {classes or "-"} | points {points or "-"} | suspension {"oui" if susp else "non"}')
    if os.environ.get('TEXTE'):
        print('    ' + texte[:int(os.environ['TEXTE'])])
