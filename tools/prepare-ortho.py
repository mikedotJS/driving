#!/usr/bin/env python3
"""Prépare les dalles de photo aérienne du jeu à partir des brutes de tools/fetch-ortho.mjs.

  python3 -I tools/prepare-ortho.py data/ortho-raw public/ortho public/maps/montreuil.json

Les brutes (20 cm) sont réduites à 50 cm (Lanczos), assemblées en une mosaïque pour que le traitement
ne laisse pas de couture entre dalles, puis :
  - les ombres portées de la prise de vue sont éclaircies : le jeu a ses propres ombres, celles de la
    photo (soleil d'une fin d'août, vers le nord-nord-ouest) les contrediraient ;
  - la couleur du toit de chaque bâtiment de la carte est relevée (toits.bin, 3 octets par bâtiment) ;
  - les emprises bâties, élargies du dévers de leurs façades, sont rebouchées avec la teinte moyenne du
    sol voisin : la photo ne sert qu'au sol, et un toit couché sur une cour y ferait une tache ;
  - chaque dalle est écrite en WebP, avec un index (grille, pas, dates de prise de vue) ;
  - la végétation est relevée sur la photo d'origine (vegetation.json, à côté des brutes) : part de
    végétation par case, d'où tools/build-map.mjs tire les jardins, et houppiers des arbres, d'où il
    tire les arbres que la carte OpenStreetMap ne connaît pas (squares, places, jardins privés).
"""
import base64, json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = None
# Une ombre est ce qui est plus sombre que SEUIL × la moyenne locale ; l'écart sous ce seuil est réduit
# à RESTE de sa valeur. La moyenne locale est prise sur un voisinage d'environ 2 × RAYON mètres.
SEUIL, RESTE, RAYON, GAIN_MAX = 0.8, 0.3, 24.0, 2.6
CHAUD, DESATURE = (1.1, 1.0, 0.84), 0.35
# Dévers des façades : marge fixe (m), part de la hauteur, plafond (m)
MARGE, DEVERS, MARGE_MAX = 1.0, 0.08, 5.5
# Largeur (m) du fondu de la photo vers le sol procédural au bord des emprises élargies
FONDU = 3.0
# Côté (m) des cases sur lesquelles la teinte du sol valide est moyennée pour remplir les emprises
VOISINAGE = 8.0
# Les pixels à moins de cette distance (m) d'une emprise élargie ne servent pas de source au remplissage
ECART_SOURCES = 2.0
# Les toits au soleil sortent pâles : leur couleur relevée est saturée un peu plus que le sol
SATURATION_TOITS = 1.25
SATURATION = 1.4
QUALITE = 65


def eclaircir_ombres(rgb: np.ndarray, pas: float) -> np.ndarray:
    """rgb : (h, l, 3) uint8. Renvoie l'image aux ombres relevées, de même forme."""
    lum = (rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722).astype(np.float32)
    h, l = lum.shape
    # moyenne locale : réduction par 16, flou gaussien, agrandissement
    k = 16
    petite = Image.fromarray(lum).resize((max(1, l // k), max(1, h // k)), Image.BOX)
    # le flou gaussien de Pillow ne prend pas les images en flottants : 8 bits suffisent à une moyenne
    petite = petite.convert('L').filter(ImageFilter.GaussianBlur(RAYON / (pas * k)))
    moy = np.asarray(petite.resize((l, h), Image.BILINEAR), dtype=np.float32)
    seuil = SEUIL * moy
    cible = np.where(lum < seuil, seuil - (seuil - lum) * RESTE, lum)
    gain = np.minimum(cible / np.maximum(lum, 4.0), GAIN_MAX)
    out = rgb.astype(np.float32) * gain[..., None]
    # À l'ombre, le sol n'est éclairé que par le ciel : relevé tel quel il vire au bleu. On le réchauffe
    # et on le désature à proportion du gain appliqué.
    t = np.clip((gain - 1.0) / 1.2, 0.0, 1.0)[..., None]
    out *= 1.0 + t * (np.array(CHAUD, np.float32) - 1.0)
    gris = (out[..., 0] * 0.2126 + out[..., 1] * 0.7152 + out[..., 2] * 0.0722)[..., None]
    out += (gris - out) * (t * DESATURE)
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def saturer(rgb: np.ndarray, k: float) -> np.ndarray:
    """Renforce la saturation : la brume de la prise de vue délave les couleurs."""
    f = rgb.astype(np.float32)
    gris = (f[..., 0] * 0.2126 + f[..., 1] * 0.7152 + f[..., 2] * 0.0722)[..., None]
    return np.clip(gris + (f - gris) * k + 0.5, 0, 255).astype(np.uint8)


def masque_bati(batiments, g, forme, pas: float, plus: float = 0.0) -> np.ndarray:
    """Masque (uint8, 255 = à reboucher) des emprises bâties, élargies du dévers possible de leurs façades.

    Sur la photo, un bâtiment penche à l'opposé du point de prise de vue : son toit et sa façade
    recouvrent le sol à son pied, d'environ 8 % de sa hauteur ici. On élargit donc chaque emprise de
    MARGE + DEVERS × hauteur, dans toutes les directions faute de connaître celle du dévers.
    """
    m = Image.new('L', (forme[1], forme[0]), 0)
    d = ImageDraw.Draw(m)
    for b in batiments:
        pts = [((b['p'][i] - g['x0']) / pas, (b['p'][i + 1] - g['z0']) / pas) for i in range(0, len(b['p']), 2)]
        if len(pts) < 3:
            continue
        marge = min(MARGE_MAX, MARGE + DEVERS * float(b.get('h', 6))) + plus
        d.polygon(pts, fill=255)
        d.line(pts + [pts[0]], fill=255, width=max(1, round(2 * marge / pas)), joint='curve')
    return np.asarray(m)


def reboucher(rgb: np.ndarray, trou: np.ndarray, douteux: np.ndarray, pas: float) -> np.ndarray:
    """Remplace les pixels de `trou` par la teinte moyenne du sol voisin.

    Le sol au pied des immeubles reçoit ainsi la teinte de la cour ou du jardin d'à côté au lieu d'un
    morceau de toit. Une pyramide (chaque niveau moyenne les pixels valides du niveau plus fin) donne
    une valeur de secours au cœur des grandes emprises, loin de tout sol visible.
    """
    # sources : le sol franchement à l'écart des bâtiments. Tout près, un débord de toit ou une emprise
    # décalée d'un mètre laissent des liserés de tuile qui déteindraient sur tout le jardin.
    valide = (douteux == 0).astype(np.float32)
    niveaux = [(rgb.astype(np.float32) * valide[..., None], valide)]
    while min(niveaux[-1][1].shape) > 2:
        c, w = niveaux[-1]
        h, l = w.shape
        c = np.pad(c, ((0, h % 2), (0, l % 2), (0, 0)))
        w = np.pad(w, ((0, h % 2), (0, l % 2)))
        c = c[0::2, 0::2] + c[1::2, 0::2] + c[0::2, 1::2] + c[1::2, 1::2]
        w = w[0::2, 0::2] + w[1::2, 0::2] + w[0::2, 1::2] + w[1::2, 1::2]
        niveaux.append((c, w))
    c, w = niveaux[-1]
    plein = c / np.maximum(w, 1e-6)[..., None]
    for c, w in reversed(niveaux[:-1]):
        h, l = w.shape
        monte = np.stack([np.asarray(Image.fromarray(plein[..., k]).resize((l, h), Image.BILINEAR)) for k in range(3)], axis=-1)
        # un pixel à peine couvert (bord de trou) se fie surtout au niveau grossier
        poids = np.minimum(w, 1.0)[..., None]
        plein = (c / np.maximum(w, 1e-6)[..., None]) * poids + monte * (1 - poids)
    # teinte moyenne du sol valide sur un large voisinage (cases de VOISINAGE m, raccordées en douceur) :
    # c'est elle qui remplit les emprises, la pyramide ne servant que là où aucun sol n'est en vue
    k = max(1, round(VOISINAGE / pas))
    H, L = valide.shape
    ph, pl = (-H) % k, (-L) % k
    c = np.pad(rgb.astype(np.float32) * valide[..., None], ((0, ph), (0, pl), (0, 0)))
    w = np.pad(valide, ((0, ph), (0, pl)))
    hh, ll = w.shape[0] // k, w.shape[1] // k
    c = c.reshape(hh, k, ll, k, 3).mean(axis=(1, 3))
    w = w.reshape(hh, k, ll, k).mean(axis=(1, 3))
    grand = lambda a: np.asarray(Image.fromarray(a).resize((ll * k, hh * k), Image.BICUBIC))[:H, :L]
    wu = np.maximum(grand(w), 0)
    cu = np.stack([grand(np.ascontiguousarray(c[..., i])) for i in range(3)], axis=-1)
    sur = np.clip((wu - 0.02) / 0.06, 0, 1)[..., None]
    fond = np.clip(cu / np.maximum(wu, 1e-3)[..., None], 0, 255) * sur + plein * (1 - sur)
    # raccord : la photo s'efface vers cette teinte sur FONDU mètres autour des emprises élargies
    flou = np.asarray(Image.fromarray(trou).filter(ImageFilter.GaussianBlur(FONDU / (2 * pas))), dtype=np.float32) / 255
    a = np.clip(2 * flou, 0, 1)[..., None]
    return np.clip(rgb * (1 - a) + fond * a + 0.5, 0, 255).astype(np.uint8)


def couleurs_toits(rgb: np.ndarray, batiments, g, pas: float) -> bytes:
    """Couleur du toit de chaque bâtiment (3 octets sRGB, dans l'ordre de la carte).

    Moyenne des pixels de l'emprise, rognée de 1,5 m quand elle reste assez grande, en écartant les
    20 % les plus sombres et les 20 % les plus clairs (ombres, verrières, reflets).
    """
    H, L = rgb.shape[:2]
    out = bytearray()
    for b in batiments:
        xs = [(b['p'][i] - g['x0']) / pas for i in range(0, len(b['p']), 2)]
        zs = [(b['p'][i + 1] - g['z0']) / pas for i in range(0, len(b['p']), 2)]
        x0, x1 = max(0, int(min(xs))), min(L, int(max(xs)) + 2)
        z0, z1 = max(0, int(min(zs))), min(H, int(max(zs)) + 2)
        if x1 <= x0 or z1 <= z0:
            # hors de la photo : pas de couleur relevée (0, 0, 0 = « garder la teinte procédurale »)
            out += bytes(3)
            continue
        pts = [(x - x0, z - z0) for x, z in zip(xs, zs)]
        m = Image.new('L', (x1 - x0, z1 - z0), 0)
        d = ImageDraw.Draw(m)
        d.polygon(pts, fill=255)
        plein = np.asarray(m) > 0
        d.line(pts + [pts[0]], fill=0, width=round(2 * 1.5 / pas))
        rogne = np.asarray(m) > 0
        sel = rogne if rogne.sum() >= 24 else plein
        px = rgb[z0:z1, x0:x1][sel].astype(np.float32)
        if len(px) == 0:
            px = rgb[min(H - 1, (z0 + z1) // 2), min(L - 1, (x0 + x1) // 2)].astype(np.float32)[None]
        if len(px) >= 10:
            lum = px @ np.array([0.2126, 0.7152, 0.0722], np.float32)
            a, z = np.quantile(lum, [0.2, 0.8])
            garde = px[(lum >= a) & (lum <= z)]
            if len(garde):
                px = garde
        c = np.clip(px.mean(axis=0) + 0.5, 1, 255).astype(np.uint8)
        out += bytes(c.tolist())
    return bytes(out)


# ───────────────────────── végétation ─────────────────────────
# Indice de vert (2V − R − B) / (R + V + B) au-dessus duquel un pixel est de la végétation
VERT = 0.03
# Houppier : vert, plus sombre que CLAIR_MAX et de texture marquée (écart type local de la clarté
# au-dessus de GRAIN) ; une pelouse est claire et lisse, un terrain synthétique sombre et lisse.
VERT_HOUPPIER, CLAIR_MAX, GRAIN = 0.025, 98.0, 6.0
# Côté ombré d'un houppier : sombre, verdâtre, et à moins de 3 m d'un houppier franc
OMBRE_CLAIR, OMBRE_GRAIN = 78.0, 3.0
# Rayons de houppier retenus (m) et côté des cases de la part de végétation (m)
RAYON_MIN, RAYON_MAX, CASE_VEG = 1.8, 6.5, 4.0
# Recouvrement admis entre deux houppiers voisins : distance d'au moins ECART × la somme des rayons
ECART, ECART_MIN = 0.8, 5.0


def boite(a: np.ndarray, rayon: int) -> np.ndarray:
    """Moyenne sur un carré de 2 × rayon + 1 pixels (image intégrale), bords prolongés."""
    k = 2 * rayon + 1
    p = np.pad(a.astype(np.float64), rayon, mode='edge')
    c = np.cumsum(np.cumsum(np.pad(p, ((1, 0), (1, 0))), axis=0), axis=1)
    return ((c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)).astype(np.float32)


def morpho(m: np.ndarray, tours: int, dilate: bool) -> np.ndarray:
    """Dilatation ou érosion d'un masque booléen, `tours` fois d'un pixel."""
    im = Image.fromarray(m.astype(np.uint8) * 255)
    f = ImageFilter.MaxFilter(3) if dilate else ImageFilter.MinFilter(3)
    for _ in range(tours):
        im = im.filter(f)
    return np.asarray(im) > 0


def vegetation(rgb: np.ndarray):
    """Masques (végétation, houppiers) de la photo d'origine `rgb` (h, l, 3) uint8, à 50 cm."""
    f = rgb.astype(np.float32)
    r, v, b = f[..., 0], f[..., 1], f[..., 2]
    vert = boite((2 * v - r - b) / (r + v + b + 1), 1)
    lum = 0.2126 * r + 0.7152 * v + 0.0722 * b
    moy = boite(lum, 2)
    grain = boite(np.sqrt(np.maximum(boite(lum * lum, 2) - moy * moy, 0)), 3)
    franc = (vert > VERT_HOUPPIER) & (moy < CLAIR_MAX) & (grain > GRAIN)
    ombre = (boite(v, 1) > boite(r, 1)) & (boite(v, 1) > boite(b, 1) * 1.06) & (moy < OMBRE_CLAIR) & (grain > OMBRE_GRAIN)
    houp = franc | (ombre & morpho(franc, 6, True))
    # fermeture (les trous d'ombre entre les branches) puis légère ouverture (les pixels isolés)
    houp = morpho(morpho(morpho(houp, 3, True), 4, False), 1, True)
    return (vert > VERT) | houp, houp


def arbres_de(houp: np.ndarray, pas: float, graine: int = 7):
    """Arbres [(colonne, ligne, rayon en m)] qui couvrent le masque des houppiers.

    La profondeur d'un pixel (nombre d'érosions qu'il supporte) est sa distance au bord du masque :
    les maxima locaux sont les centres des houppiers. Ils sont retenus du plus large au plus étroit,
    chacun écartant ses voisins trop proches ; un bois se couvre ainsi de grands arbres espacés.
    """
    nmax = int(RAYON_MAX / pas) + 1
    prof = np.zeros(houp.shape, np.uint8)
    im = Image.fromarray(houp.astype(np.uint8) * 255)
    for _ in range(nmax):
        prof += (np.asarray(im) > 0)
        im = im.filter(ImageFilter.MinFilter(3))
    nmin = max(1, int(RAYON_MIN / pas))
    sommet = (prof >= nmin) & (prof == np.asarray(Image.fromarray(prof).filter(ImageFilter.MaxFilter(5))))
    zs, xs = np.nonzero(sommet)
    d = prof[zs, xs].astype(np.int32)
    # à profondeur égale, ordre tiré au sort (mais reproductible) : sinon les arbres d'un bois s'alignent
    ordre = np.lexsort((np.random.default_rng(graine).random(len(d)), -d))
    case = 2 * RAYON_MAX
    grille, out = {}, []
    for k in ordre:
        x, z, r = xs[k] * pas, zs[k] * pas, min(RAYON_MAX, d[k] * pas * 0.92)
        ci, cj = int(x // case), int(z // case)
        libre = True
        for i in (ci - 1, ci, ci + 1):
            for j in (cj - 1, cj, cj + 1):
                for (x2, z2, r2) in grille.get((i, j), ()):
                    if (x - x2) ** 2 + (z - z2) ** 2 < max(ECART_MIN, ECART * (r + r2)) ** 2:
                        libre = False
                        break
                if not libre:
                    break
            if not libre:
                break
        if libre:
            grille.setdefault((ci, cj), []).append((x, z, r))
            out.append((float(x), float(z), float(r)))
    return out


def masque_polygones(polys, g, forme, pas: float, marge: float = 0.0) -> np.ndarray:
    """Masque booléen de polygones [(contour, [trous])] en mètres, élargis de `marge`."""
    m = Image.new('L', (forme[1], forme[0]), 0)
    d = ImageDraw.Draw(m)
    px = lambda pts: [((x - g['x0']) / pas, (z - g['z0']) / pas) for x, z in pts]
    for o, trous in polys:
        if len(o) < 3:
            continue
        d.polygon(px(o), fill=255)
        for t in trous:
            if len(t) >= 3:
                d.polygon(px(t), fill=0)
        if marge > 0:
            d.line(px(o) + px(o[:1]), fill=255, width=max(1, round(2 * marge / pas)), joint='curve')
    return np.asarray(m) > 0


def releve_vegetation(brute: np.ndarray, carte, g, pas: float):
    """Part de végétation par case et arbres de la photo, pour tools/build-map.mjs."""
    paires = lambda p, k=1.0, ox=0.0, oz=0.0: [(ox + p[i] * k, oz + p[i + 1] * k) for i in range(0, len(p), 2)]
    bati = masque_polygones([(paires(b['p']), []) for b in carte['buildings']], g, brute.shape, pas, 0.5)
    cm, c = 0.01, float(carte['chunk'])
    chaussee = []
    for cle, dalle in carte['chunks'].items():
        ci, cj = (int(v) for v in cle.split(','))
        for p in dalle.get('r', []):
            chaussee.append((paires(p['o'], cm, ci * c, cj * c), [paires(t, cm, ci * c, cj * c) for t in p.get('h', [])]))
    route = masque_polygones(chaussee, g, brute.shape, pas, 0.5)
    veg, houp = vegetation(brute)
    veg &= ~bati
    houp &= ~bati & ~route
    # les arbres déjà dans la carte (OpenStreetMap) gardent leur houppier : on ne les double pas
    connus = Image.new('L', (brute.shape[1], brute.shape[0]), 0)
    d = ImageDraw.Draw(connus)
    for t in carte.get('trees', []):
        if len(t) > 5 and t[5]:
            continue
        x, z = (t[0] - g['x0']) / pas, (t[1] - g['z0']) / pas
        d.ellipse((x - 4.5 / pas, z - 4.5 / pas, x + 4.5 / pas, z + 4.5 / pas), fill=255)
    houp &= ~(np.asarray(connus) > 0)
    arbres = [[round(g['x0'] + x, 1), round(g['z0'] + z, 1), round(r, 1)] for x, z, r in arbres_de(houp, pas)]
    # part de végétation du sol non bâti, par cases de CASE_VEG m (255 = tout ; 0 aussi là où tout est bâti)
    k = max(1, round(CASE_VEG / pas))
    H, L = veg.shape
    hh, ll = H // k, L // k
    somme = lambda a: a[:hh * k, :ll * k].reshape(hh, k, ll, k).sum(axis=(1, 3)).astype(np.float32)
    libre = somme(~bati)
    part = np.where(libre >= k * k * 0.15, somme(veg) / np.maximum(libre, 1), 0)
    return {
        'x0': g['x0'], 'z0': g['z0'], 'case': k * pas, 'l': ll, 'h': hh,
        'part': base64.b64encode(np.clip(part * 255 + 0.5, 0, 255).astype(np.uint8).tobytes()).decode('ascii'),
        'arbres': arbres,
    }, float(veg.mean()), float(houp.mean())


def main():
    brut, sortie, fcarte = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(fcarte, encoding='utf-8') as f:
        carte = json.load(f)
    batiments = carte['buildings']
    with open(os.path.join(brut, 'grille.json'), encoding='utf-8') as f:
        g = json.load(f)
    pas, cote = float(g['pas']), float(g['cote'])
    n = round(cote / pas)
    nx, nz = int(g['nx']), int(g['nz'])
    mosaique = np.zeros((nz * n, nx * n, 3), np.uint8)
    presentes = []
    for j in range(nz):
        for i in range(nx):
            f = os.path.join(brut, f'{i}_{j}.jpg')
            if not os.path.exists(f):
                continue
            im = Image.open(f).convert('RGB').resize((n, n), Image.LANCZOS)
            mosaique[j * n:(j + 1) * n, i * n:(i + 1) * n] = np.asarray(im)
            presentes.append((i, j))
    avant = mosaique.mean()
    # végétation : relevée sur la photo d'origine, avant que les ombres soient relevées et les couleurs saturées
    releve, pveg, phoup = releve_vegetation(mosaique, carte, g, pas)
    with open(os.path.join(brut, 'vegetation.json'), 'w', encoding='utf-8') as f:
        json.dump(releve, f, separators=(',', ':'))
    print(f"végétation : {100 * pveg:.1f} % du sol non bâti, houppiers {100 * phoup:.1f} %, {len(releve['arbres'])} arbres hors de ceux de la carte")
    mosaique = saturer(eclaircir_ombres(mosaique, pas), SATURATION)
    toits = couleurs_toits(saturer(mosaique, SATURATION_TOITS), batiments, g, pas)
    trou = masque_bati(batiments, g, mosaique.shape, pas)
    mosaique = reboucher(mosaique, trou, masque_bati(batiments, g, mosaique.shape, pas, ECART_SOURCES), pas)
    os.makedirs(sortie, exist_ok=True)
    total = 0
    for i, j in presentes:
        dst = os.path.join(sortie, f'{i}_{j}.webp')
        Image.fromarray(mosaique[j * n:(j + 1) * n, i * n:(i + 1) * n]).save(dst, 'WEBP', quality=QUALITE, method=6)
        total += os.path.getsize(dst)
    # couleur moyenne de la photo (sRGB, 0 à 1) : le jeu s'en sert pour régler l'exposition du mélange
    moyenne = [round(float(v) / 255, 4) for v in mosaique.reshape(-1, 3)[::97].mean(axis=0)]
    index = {
        'source': 'IGN – BD ORTHO', 'licence': 'Licence Ouverte Etalab 2.0', 'prises': g.get('prises', []),
        'x0': g['x0'], 'z0': g['z0'], 'cote': cote, 'nx': nx, 'nz': nz, 'pixels': n, 'pas': pas,
        'moyenne': moyenne, 'dalles': [f'{i}_{j}' for i, j in presentes],
    }
    with open(os.path.join(sortie, 'toits.bin'), 'wb') as f:
        f.write(toits)
    index['batiments'] = len(batiments)
    with open(os.path.join(sortie, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    print(f'public/ortho : {len(presentes)} dalles de {n} × {n} pixels, {total / 1e6:.2f} Mo, {len(toits) // 3} couleurs de toit, {100 * (trou > 0).mean():.1f} % rebouché ; '
          f'luminance moyenne {avant:.1f} → {mosaique.mean():.1f} après éclaircissement des ombres')


if __name__ == '__main__':
    main()
