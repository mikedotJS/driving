#!/usr/bin/env python3
"""Découpe les lots de voix (un MP3 par lot, répliques séparées par des silences) en un fichier par réplique.

usage : python3 -I tools/voix/decoupe.py <dossier des lots (lotNN/a.mp3)> <public/audio/voix>
"""
import json, os, re, subprocess, sys

src, out = sys.argv[1], sys.argv[2]
here = os.path.dirname(os.path.abspath(__file__))
lots = json.load(open(os.path.join(here, 'lots.json'), encoding='utf-8'))
os.makedirs(out, exist_ok=True)
manifest, bad = [], []
for i, lot in enumerate(lots):
    f = os.path.join(src, f'lot{i:02d}', 'a.mp3')
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostdin', '-i', f, '-af', 'silencedetect=noise=-38dB:d=0.9', '-f', 'null', '-'], capture_output=True, text=True)
    dur = re.search(r'Duration: (\d+):(\d+):([\d.]+)', r.stderr)
    total = int(dur.group(1)) * 3600 + int(dur.group(2)) * 60 + float(dur.group(3))
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', r.stderr)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', r.stderr)]
    # segments parlés = intervalles entre les silences
    cuts, t = [], 0.0
    for s, e in zip(starts, ends):
        if s - t > 0.25: cuts.append((t, s))
        t = e
    if total - t > 0.25: cuts.append((t, total))
    keys = lot['keys']
    # une pause interne à une réplique a été prise pour une séparation : on recolle sur le silence le plus court
    while len(cuts) > len(keys):
        j = min(range(len(cuts) - 1), key=lambda k: cuts[k + 1][0] - cuts[k][1])
        cuts[j:j + 2] = [(cuts[j][0], cuts[j + 1][1])]
    if len(cuts) != len(keys):
        bad.append((i, len(cuts), len(keys)))
        continue
    for key, (a, b) in zip(keys, cuts):
        a = max(0, a - 0.06); b = min(total, b + 0.22)
        d = b - a
        dst = os.path.join(out, key + '.mp3')
        subprocess.run(['ffmpeg', '-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', f'{a:.3f}', '-t', f'{d:.3f}', '-i', f,
                        '-af', f'afade=t=in:d=0.02,afade=t=out:st={max(0, d - 0.08):.3f}:d=0.08,loudnorm=I=-17:TP=-1.5:LRA=11',
                        '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', dst], check=True)
        manifest.append(key)
json.dump(sorted(manifest), open(os.path.join(out, 'manifest.json'), 'w'))
print(len(manifest), 'répliques écrites ;', 'lots à revoir :', bad)
