#!/usr/bin/env python3
"""Redimensionne et recompresse les textures Poly Haven (CC0) vers public/textures."""
import os, shutil, sys
from PIL import Image

SRC = os.path.join(os.path.dirname(__file__), '..', 'data', 'polyhaven')
DST = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures')
os.makedirs(DST, exist_ok=True)

# nom → (taille diffuse, taille normale, taille ARM)
SIZES = {
    'asphalt_02': (1024, 1024, 512),
    'asphalt_04': (1024, 1024, 512),
    'concrete_pavement': (1024, 1024, 512),
    'cobblestone_floor_08': (1024, 1024, 512),
    'granite_tile': (512, 512, 256),
    'painted_plaster_wall': (1024, 512, 512),
    'beige_wall_001': (1024, 512, 512),
    'red_brick_03': (1024, 512, 512),
    'concrete_wall_003': (1024, 512, 512),
    'plastered_stone_wall': (1024, 512, 512),
    'leafy_grass': (1024, 512, 256),
    'grey_roof_01': (512, 512, 256),
}
total = 0
for name, (sd, sn, sa) in SIZES.items():
    for kind, size, q in (('diff', sd, 84), ('nor_gl', sn, 82), ('arm', sa, 80)):
        src = os.path.join(SRC, f'{name}_{kind}.jpg')
        dst = os.path.join(DST, f'{name}_{kind.replace("_gl", "")}.jpg')
        im = Image.open(src).convert('RGB')
        if im.size[0] != size:
            im = im.resize((size, size), Image.LANCZOS)
        im.save(dst, 'JPEG', quality=q, optimize=True)
        total += os.path.getsize(dst)
for f in os.listdir(SRC):
    if f.endswith('.hdr'):
        shutil.copy(os.path.join(SRC, f), os.path.join(DST, f.replace('_puresky_2k', '').replace('kloofendal_48d_partly_cloudy', 'sky_day').replace('kloofendal_overcast', 'sky_overcast')))
        total += os.path.getsize(os.path.join(SRC, f))
print(f'public/textures : {total / 1e6:.1f} Mo')
