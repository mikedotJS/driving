# Réalisme : ce qui a été mesuré

Ce document rassemble les vérifications chiffrées du simulateur. Tout ce qui suit est rejoué par
`npm test` (physique, volant, barème, pilote automatique) ou par les outils de `tools/essais/`.

## 1. La voiture face à une citadine réelle

Référence : Renault Clio V 1.0 TCe 100 (100 ch, 160 N·m, 1 178 kg à vide, 0 à 100 km/h en 11,8 s,
187 km/h), d'après les fiches techniques publiées par
[auto-data.net](https://www.auto-data.net/fr/renault-clio-v-phase-i-1.0-tce-100hp-36964) et
[zeperfs.com](https://zeperfs.com/en/fiche8078-renault-clio-v-1-0-tce.htm). Les valeurs « Jeu » sont
mesurées en faisant rouler le modèle physique (`tests/realisme.test.ts`, `tests/car.test.ts`).

| Grandeur | Jeu | Voiture réelle |
|---|---|---|
| Masse en ordre de marche | 1 255 kg (conducteur compris) | 1 178 kg à vide |
| Couple maximal | 160 N·m | 160 N·m |
| Puissance maximale | 74 kW (100 ch) | 74 kW (100 ch) |
| Empattement / longueur | 2,58 m / 4,05 m | 2,58 m / 4,05 m |
| 0 à 100 km/h | 11,7 s | 11,8 s |
| Vitesse maximale | 187 km/h | 187 km/h |
| Freinage 50 → 0 km/h | 11,1 m (0,89 g) | ≈ 10 m (1 g, pneus été sur sec) |
| Freinage 100 → 0 km/h | 41,0 m (0,96 g) | 36 à 40 m (ordre de grandeur des essais de presse, non sourcé ici) |
| Diamètre de braquage entre trottoirs | 10,4 m | non retrouvé dans les fiches consultées |
| Accélération latérale maximale | 0,92 g, sous-vireur à la limite | — |

Comportements vérifiés par test : ralenti tenu, **calage** si l'embrayage est relâché d'un coup en
première sans gaz, démarrage au point de patinage sans accélérer, rapport refusé sans débrayer,
rampage en boîte automatique, immobilité parfaite à l'arrêt, rappel du volant vers le centre.

## 2. Le volant Logitech G923

Aucun volant n'était branché à la machine de développement. La chaîne complète est donc vérifiée
avec un **G923 émulé** (`tests/volant.test.ts`, 10 tests) :

- un faux périphérique *Gamepad* : reconnaissance du volant, direction 1:1 sur 900°, pédales
  (repos à +1, zone morte), palettes, levier en H, assistant de calibration quel que soit l'ordre des
  axes, profil mémorisé ;
- un faux périphérique *WebHID* qui enregistre les trames envoyées. Le code source des pilotes Linux a
  été relu pour fixer les trames attendues :
  - **G923 PlayStation/PC** : le pilote officiel `hid-lg4ff.c` ne connaît pas ce volant ; c'est le
    pilote communautaire [new-lg4ff](https://github.com/berarma/new-lg4ff) qui le prend en charge
    (046d:c266 en mode natif, 046d:c267 en mode PlayStation). Le jeu envoie les mêmes commandes :
    `F5` (centrage coupé), `F8 81 84 03` (rotation 900°), `11 00 <niveau>` pour lancer l'effort
    constant, `1C 00 <niveau>` pour le rafraîchir, `13` pour l'arrêter (`80` = neutre). En mode
    PlayStation, il demande d'abord le passage en mode natif (rapport `30` : `F8 09 07 01 01`),
    après quoi le volant se reconnecte et doit être autorisé de nouveau ;
  - **G923 Xbox/PC** (046d:c26e) : protocole HID++ de `hid-logitech-hidpp.c` — fonctionnalité `0x8123`,
    remise à zéro (`11`), gains (`81`), effet constant à démarrage automatique téléchargé par la
    fonction `21`, force sur 16 bits aux octets 6 et 7 des paramètres.

Ce qui reste invérifiable sans matériel : le **sens** de l'effort — aucun des deux pilotes n'indique de
quel côté de la valeur neutre le volant part à droite ; une case « Inverser » et un bouton « Tester »
sont prévus pour cela —, l'acceptation par le navigateur du rapport `30` de changement de mode, et le
ressenti.

## 3. Le Code de la route

Voir la section 7 de [`code-de-la-route-recherche.md`](code-de-la-route-recherche.md) : chaque
article du barème a été relu le 20 novembre 2026 dans le texte officiel (base LEGI publiée par la
DILA, script `tools/bareme/verifier-legi.py`) et les montants sur les fiches de service-public ;
aucune valeur n'a dû être corrigée. `tests/bareme.test.ts` fige le tout (32 tests).

## 4. Un élève qui conduit bien n'est pas sanctionné à tort

Un conducteur automatique respectueux du Code parcourt des itinéraires de leçon dans la
circulation, avec la vraie physique ; le moniteur ne doit rien lui reprocher de grave.

| Essai | Résultat |
|---|---|
| `npm test` : 5 leçons (feux, priorité, tournants, giratoire, grands axes) | 5 sur 5 sans faute grave ni accrochage |
| `npm run test:endurance` : 48 trajets (6 thèmes × 8 tirages) | 48 terminés, 48 sans faute grave ni accrochage, aucun contact avec une bordure ; même résultat sur 48 autres trajets tirés avec des graines jamais utilisées pendant la mise au point (`BASE=500`) |
| Circulation seule, 45 véhicules autour de la Croix de Chavaux pendant 6 min, 8 tirages | aucun véhicule immobilisé plus de 40 s en fin d'essai ; 1 à 35 chevauchements instantanés entre voitures selon le tirage (2 sur le tirage de référence, arrêt le plus long 52 s) |

Ces essais ont fait corriger plusieurs **fausses fautes** : refus de priorité signalé à une voiture
arrêtée à sa ligne de stop, sens interdit dans une rue à sens unique tracée à l'envers, clignotant
exigé avant un carrefour impossible à anticiper, ligne de stop placée 11 m trop tôt, ligne de feu
décalée de plusieurs mètres dans les rues courbes, autobus qui balayait la voie voisine en tournant.
Les itinéraires de leçon ne sont retenus que si chaque virage est praticable sans toucher une bordure.

Garde-fous contre les embouteillages : on n'entre pas dans un carrefour complexe déjà encombré ; entre
usagers à l'arrêt qui se cèdent mutuellement le passage, celui qui attend depuis le plus longtemps
passe ; une voiture qui barre la route du joueur à l'arrêt s'écarte ou recule ; en dernier recours
(30 s de blocage complet près du joueur, ou 75 s d'immobilisation à plus de 45 m de lui), le véhicule
est retiré de la circulation.

## 5. Charge de rendu

Mesurée dans la version de production (`npm run build`), scène de boulevard avec circulation,
réglage de qualité par défaut :

| Mesure | Valeur |
|---|---|
| Simulation (physique à 1 kHz, circulation, règles) | 0,18 ms de processeur par image |
| Appels de dessin par image | ≈ 170 |
| Triangles par image | ≈ 1,3 million |
| Textures / géométries en mémoire | 38 / 215 |

Le nombre d'images par seconde sur une carte graphique n'a **pas** pu être mesuré : la machine de
développement n'en a pas (rendu logiciel SwiftShader sur 4 cœurs, où le jeu tourne à 0,24 image par
seconde — chiffre sans rapport avec un vrai GPU). 170 appels et 1,3 million de triangles sont une
charge modeste pour une carte graphique dédiée récente.

Pour ne pas dépendre de cette mesure, le jeu **se règle lui-même** : un régulateur mesure la cadence
réelle et, si elle reste sous 40 images par seconde pendant 3 s, allège l'affichage d'un cran
(résolution, distance de vue, puis rétroviseurs en dernier recours) ; il rétablit un cran après 25 s
au-dessus de 57 images par seconde. Vérifié dans le navigateur : sur le rendu logiciel, il descend au
dernier cran et la cadence mesurée passe de 0,24 à 0,67 image par seconde. Il se désactive dans
*Réglages → Fluidité automatique* (ou avec `?perf=fixe` dans l'adresse).

## 6. Captures

![Habitacle, cyclistes devant](captures/habitacle-cyclistes.jpg)
![Vue extérieure](captures/vue-exterieure-feu.jpg)
![Habitacle, zone 30](captures/habitacle-pietons.jpg)
