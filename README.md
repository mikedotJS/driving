# Conduite — auto-école virtuelle à Montreuil et Paris 20ᵉ

Un simulateur pour **apprendre à conduire avec un volant** (Logitech G923 en particulier) dans les
**vraies rues de Montreuil et du 20ᵉ arrondissement de Paris**, avec un moniteur qui relève chaque
manquement au **Code de la route** et rappelle la règle, l'article et la sanction encourue.

Le jeu tourne dans le navigateur (Chrome ou Edge recommandés) : rien à installer en dehors de Node.js.

## Lancer le jeu

```bash
npm install
npm run dev        # puis ouvrir http://localhost:5173
```

Pour une version optimisée : `npm run build` puis `npm run preview`.

## Brancher le Logitech G923

1. Branchez le volant et lancez **G HUB** ; laissez l'angle de rotation à **900°**.
2. Ouvrez le jeu dans **Chrome ou Edge**, puis appuyez sur un bouton du volant : il est détecté
   (« Volant : Logitech G923 » en bas à droite).
3. *Volant et commandes → Calibrer…* : tournez le volant de butée à butée puis enfoncez chaque
   pédale. Le jeu repère ainsi quel axe correspond à quoi, quels que soient le système, le navigateur
   et le mode du volant (PlayStation, Xbox ou PC). Le profil est mémorisé.
4. *Boîte de vitesses* : « Manuelle » utilise la **pédale d'embrayage** (point de patinage, calage) ;
   cochez « Levier en H » si vous avez le Driving Force Shifter, sinon les palettes changent de rapport.
5. **Retour de force** (facultatif) : *Connecter le volant…* ouvre la fenêtre WebHID du navigateur.
   Cliquez sur *Tester* : le volant doit partir vers la droite, sinon cochez « Inverser ».

> Le retour de force est **expérimental** : il a été écrit d'après les protocoles Logitech
> (trames classiques du G29/G923 PlayStation, HID++ du G920/G923 Xbox) mais **n'a pas pu être essayé
> sur un volant réel** depuis l'environnement de développement. Commencez avec une force modérée.
> Sans retour de force, le volant fonctionne parfaitement avec le ressort de centrage de G HUB.

Sans volant, le jeu se pilote au clavier (AZERTY) ou à la manette — voir *Commandes et aide*.

## Ce que l'on apprend

| Mode | Contenu |
|---|---|
| **Leçons 1 à 9** | Progression d'auto-école (référentiel REMC) : s'installer et démarrer sans caler, boîte de vitesses et allure, tourner, priorité à droite, feux/stops/cédez-le-passage, piétons et zones 30, giratoires, grands axes et couloirs de bus, itinéraire en autonomie. |
| **Conduite libre** | 85 km de rues, circulation et piétons, moniteur à bord. |
| **Examen blanc** | Parcours suivi en silence par l'inspecteur, questions de vérification / sécurité routière / premiers secours, notation sur la **grille officielle de 31 points** (20 points et aucune faute éliminatoire pour réussir). |

Fautes relevées (avec article, amende forfaitaire et points) : excès de vitesse selon le barème,
feu rouge et feu orange, stop non marqué, refus de priorité (à droite, cédez-le-passage, giratoire,
en tournant à gauche), **refus de priorité à un piéton**, sens interdit, circulation à gauche, ligne
continue, couloir de bus, bande cyclable, trottoir, clignotant oublié, distance de sécurité, ceinture,
arrêt sur un passage piéton, klaxon abusif… ainsi que les erreurs de maîtrise : calage, rapport passé
sans débrayer, sur-régime et sous-régime, bordure heurtée, accrochage.

Le barème est celui en vigueur en **novembre 2026**, notamment :

- excès de moins de 5 km/h : amende mais **plus de retrait de point** (depuis le 1ᵉʳ janvier 2024) ;
- excès de 50 km/h ou plus : **délit** dès la première fois (depuis le 29 décembre 2025) ;
- refus de priorité à un piéton : **6 points** ;
- dépassement d'un cycliste : 1 m en ville, 1,50 m hors agglomération ;
- Paris et Montreuil en « ville 30 », zones de rencontre à 20 km/h, double-sens cyclable.

Les sources consultées et leur niveau de fiabilité sont détaillés dans
[`docs/code-de-la-route-recherche.md`](docs/code-de-la-route-recherche.md). Les sites officiels
n'étant pas joignables depuis l'environnement de développement, les textes ont été lus à travers des
extraits de recherche : chaque ligne y est marquée selon sa source. **En cas de doute, Légifrance fait foi.**

## Réalisme de la conduite

- Modèle dynamique maison (`src/vehicle/car.ts`) : pneus « formule magique » en glissement combiné
  avec longueurs de relaxation (comportement juste à très basse vitesse et à l'arrêt), transfert de
  charge par une caisse suspendue (roulis, tangage, pompage), différentiel ouvert, ABS.
- Moteur 3 cylindres turbo de 100 ch : courbe de couple, frein moteur, régulation de ralenti avec
  anti-calage limité, **calage**, démarreur ; embrayage à friction avec point de patinage ; boîte
  6 rapports manuelle, manuelle à embrayage piloté ou automatique (rampage).
- Vérifié par des tests : 0 à 100 km/h en 11,7 s, freinage de 50 à 0 km/h en 10,3 m, diamètre de
  braquage de 10,4 m, 0,92 g en virage avec sous-virage à la limite — les chiffres d'une citadine réelle.
- Volant 1:1 sur 900°, couple d'auto-alignement des pneus restitué dans le retour de force.

## Le décor

- Plan des rues, sens uniques, limitations, feux, stops, passages piétons, bâtiments, arbres et
  espaces verts issus d'**OpenStreetMap** : 85 km de voirie, 491 carrefours dont 354 en priorité à
  droite, 1 098 passages piétons, 12 265 bâtiments.
- Signalisation française : panneaux dessinés d'après l'instruction interministérielle, feux
  tricolores placés avant le carrefour avec leur **répétiteur bas**, figurines piétons, marquages
  T1/T'1/T3/T'2, lignes d'effet des feux, plaques de rue parisiennes.
- Rendu physique (three.js) : ciel HDR, ombres en cascade, vitrages réfléchissants, habitacle avec
  **trois rétroviseurs réels**, regard vers les angles morts.

## Organisation du code

```
tools/            préparation des données (hors jeu)
  fetch-osm.sh      téléchargement OpenStreetMap par tuiles
  build-map.mjs     OSM → public/maps/montreuil.json (graphe, profils en travers, polygones)
  render-map.mjs    rendu 2D de contrôle de la carte
  fetch-assets.sh, prepare-assets.py   textures et ciel Poly Haven
src/
  map/              réseau routier (voies, carrefours, feux, priorités), itinéraires
  vehicle/          physique de la voiture
  input/            volant / manette / clavier, retour de force WebHID
  traffic/          véhicules IA et piétons
  rules/            catalogue d'infractions et détection des fautes
  world/            génération du décor (chaussée, façades, panneaux, mobilier, stationnement)
  render/           éclairage, matériaux, caméras et rétroviseurs, modèles 3D
  audio/            son moteur synthétisé, voix du moniteur
  game/, ui/        leçons, examen, réglages, écrans
tests/            tests unitaires (physique, réseau, circulation, règles)
dev/              pages de mise au point de modules isolés
```

`npm test` lance les tests ; `npm run map:fetch && npm run map:build` régénère la carte
(il suffit de changer la zone dans `tools/fetch-osm.sh` et `tools/build-map.mjs` pour un autre quartier).

## Limites connues

- Le relief n'est pas modélisé (terrain plat), le boulevard périphérique et les tunnels sont exclus.
- Les façades sont procédurales : la silhouette des îlots est réelle, pas l'architecture de chaque immeuble.
- Les régimes de priorité viennent d'OpenStreetMap : un stop ou un feu non cartographié devient une
  priorité à droite dans le jeu.
- Ce simulateur est un outil d'entraînement : **il ne remplace pas les leçons avec un enseignant diplômé**.

## Crédits et licences

- Données cartographiques © les contributeurs d'[OpenStreetMap](https://www.openstreetmap.org/copyright), licence ODbL.
- Ciel HDR et textures : [Poly Haven](https://polyhaven.com), CC0.
- Moteur 3D : [three.js](https://threejs.org), licence MIT.
