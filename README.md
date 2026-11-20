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
   Cliquez sur *Vérifier* et lâchez le volant : le jeu lui envoie une poussée vers la droite, lit sa
   position, et constate lui-même qu'il répond dans le bon sens — sinon il inverse le sens et revérifie.
6. **Fluidité** : *Réglages → Mesurer la fluidité* fait conduire le moniteur 20 secondes et affiche la
   cadence d'images de votre machine, le nom de la carte graphique et un conseil de réglage. Pour
   repère : sur un Mac M1 virtualisé (GPU modeste), la même mesure donne environ 41 images/s en 1080p
   qualité moyenne ; la qualité haute y est trop lourde (24 images/s avec synchronisation verticale) —
   détail dans `docs/realisme.md`.

> Le retour de force **n'a pas pu être essayé sur un volant réel** depuis l'environnement de
> développement. Il est vérifié avec un G923 émulé : les trames envoyées sont celles des pilotes Linux,
> dont le code source a été relu ([new-lg4ff](https://github.com/berarma/new-lg4ff) pour le G923
> PlayStation/PC, `hid-logitech-hidpp.c` pour le G923 Xbox — voir `tests/volant.test.ts`). Si le volant
> est en mode PlayStation, le jeu demande le passage en mode natif : il se reconnecte, cliquez de
> nouveau sur *Connecter le volant*. Le **sens** de l'effort retenu par défaut est celui que donnent,
> mises bout à bout, les conventions de SDL, du noyau Linux et de ces pilotes (octet inférieur à 0x80 =
> effort vers la droite ; détail en tête de `src/input/ffb.ts`) — aucun texte ne l'énonce directement
> et il reste à confirmer sur le matériel, comme le ressenti. C'est le jeu qui s'en charge sur votre
> volant : le bouton *Vérifier* envoie une poussée, lit la position du volant et corrige le sens s'il
> le faut (la case « Inverser » reste disponible) ; commencez avec une force modérée. Sans retour de force, le volant
> fonctionne avec le ressort de centrage de G HUB.

Sans volant, le jeu se pilote au clavier (AZERTY) ou à la manette — voir *Commandes et aide*.

## Ce que l'on apprend

| Mode | Contenu |
|---|---|
| **Leçons 1 à 9** | Progression d'auto-école (référentiel REMC) : s'installer et démarrer sans caler, boîte de vitesses et allure, tourner, priorité à droite, feux/stops/cédez-le-passage, piétons et zones 30, giratoires, grands axes et couloirs de bus, itinéraire en autonomie. |
| **Conduite libre** | 85 km de rues, circulation, piétons et cyclistes, moniteur à bord. |
| **Démonstration** | À tout moment (touche **O** ou menu pause), le moniteur prend le volant et montre la bonne conduite sur l'itinéraire en cours ; un coup de frein vous rend la main. |
| **Examen blanc** | Parcours suivi en silence par l'inspecteur, questions de vérification / sécurité routière / premiers secours, notation sur la **grille officielle de 31 points** (20 points et aucune faute éliminatoire pour réussir). |

Fautes relevées (avec article, amende forfaitaire et points) : excès de vitesse selon le barème,
feu rouge et feu orange, stop non marqué, refus de priorité (à droite, cédez-le-passage, giratoire,
en tournant à gauche), **refus de priorité à un piéton**, sens interdit, circulation à gauche, ligne
continue, couloir de bus, bande cyclable, **dépassement d'un cycliste à moins d'un mètre**, trottoir,
clignotant oublié, distance de sécurité, ceinture,
arrêt sur un passage piéton, klaxon abusif… ainsi que les erreurs de maîtrise : calage, rapport passé
sans débrayer, sur-régime et sous-régime, bordure heurtée, accrochage.

Chaque remarque est **dite par le moniteur** (87 répliques enregistrées avec une voix française
ElevenLabs, dans `public/audio/voix/` ; synthèse vocale du navigateur en repli) et affichée avec la
règle, l'article, l'amende et les points.

Le barème est celui en vigueur en **novembre 2026**, notamment :

- excès de moins de 5 km/h : amende mais **plus de retrait de point** (depuis le 1ᵉʳ janvier 2024) ;
- excès de 50 km/h ou plus : **délit** dès la première fois (depuis fin décembre 2025) ;
- refus de priorité à un piéton : **6 points** ;
- dépassement d'un cycliste : 1 m en ville, 1,50 m hors agglomération ;
- Paris et Montreuil en « ville 30 », zones de rencontre à 20 km/h, double-sens cyclable.

Le catalogue a été **vérifié le 20 novembre 2026 sur le texte officiel** : chaque article cité a été
relu dans la base LEGI publiée en données ouvertes par la DILA (l'éditeur de Légifrance), et les
montants sur les fiches de service-public ; aucune valeur n'a dû être corrigée. Le détail, article
par article avec les identifiants des versions en vigueur, se trouve dans la section 7 de
[`docs/code-de-la-route-recherche.md`](docs/code-de-la-route-recherche.md), et `tests/bareme.test.ts`
fige les montants et les points vérifiés. **En cas de doute, Légifrance fait foi.**

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

## Une circulation qui respecte le Code

Les autres usagers suivent les mêmes règles que vous : feux, stops, priorité à droite, priorité de
l'anneau dans les giratoires, arrêt devant les piétons. Un **conducteur automatique** (celui de la
démonstration) sert aussi de banc d'essai : `npm test` lui fait parcourir cinq leçons dans la
circulation et exige qu'il arrive au bout sans aucune faute grave ni accrochage — c'est ce qui limite
les fausses fautes signalées à un élève qui conduit bien. Le balayage plus large (`npm run test:endurance`,
48 trajets par série, départ choisi comme dans le jeu) passe sur 21 séries avec le code final : 1008
trajets sur 1008 sans faute grave ni accrochage. Sur les séries jamais vues, à leur premier passage,
le taux était de 858 sur 864 (99,3 %) : chaque échec a été diagnostiqué et corrigé, et il reste
vraisemblablement des situations rares non rencontrées (`BASE=1300 npm run test:endurance` pour en rejouer une). Dans les
grandes places comme la Croix de Chavaux, chaque véhicule réserve son trajet avant d'entrer : les
carrosseries ne se chevauchent pratiquement plus (17 essais de 6 minutes sur 18 sans aucun chevauchement). Les mesures (physique comparée à une
citadine réelle, volant émulé, fluidité mesurée sur une carte graphique réelle, captures) sont dans [`docs/realisme.md`](docs/realisme.md).

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
  traffic/          véhicules IA, piétons et cyclistes
  rules/            catalogue d'infractions et détection des fautes
  world/            génération du décor (chaussée, façades, panneaux, mobilier, stationnement)
  render/           éclairage, matériaux, caméras et rétroviseurs, modèles 3D
  audio/            son moteur synthétisé, voix du moniteur
  game/, ui/        leçons, examen, démonstration (pilote automatique), réglages, écrans
tests/            tests (physique et réalisme, volant émulé, barème, réseau, circulation, règles, pilote automatique)
tools/essais/     diagnostics : trace d'un trajet, chevauchements, plan de dessus d'un carrefour, balayage,
                  contrôle des leçons et du volant (simulé) dans le navigateur, mesure de fluidité
tools/voix/       répliques du moniteur : textes, lots, découpage des enregistrements
dev/              pages de mise au point de modules isolés
```

`npm test` lance les tests ; `npm run map:fetch && npm run map:build` régénère la carte
(il suffit de changer la zone dans `tools/fetch-osm.sh` et `tools/build-map.mjs` pour un autre quartier).

## Limites connues

- Le relief n'est pas modélisé (terrain plat), le boulevard périphérique et les tunnels sont exclus.
- Les façades sont procédurales : la silhouette des îlots est réelle, pas l'architecture de chaque immeuble.
- Les régimes de priorité viennent d'OpenStreetMap : un stop ou un feu non cartographié devient une
  priorité à droite dans le jeu.
- Les cyclistes ne circulent que sur les bandes cyclables cartographiées (4 km) ; les voitures de
  la circulation ne changent pas de file.
- Quelques carrefours très serrés demandent de bien élargir sa trajectoire pour ne pas toucher la
  bordure ; les itinéraires de leçon évitent les épingles impraticables.
- Le nombre d'images par seconde n'a pas été mesuré sur une vraie carte graphique ; le jeu allège
  de lui-même l'affichage quand la cadence chute (*Réglages → Fluidité automatique*).
- Ce simulateur est un outil d'entraînement : **il ne remplace pas les leçons avec un enseignant diplômé**.

## Crédits et licences

- Données cartographiques © les contributeurs d'[OpenStreetMap](https://www.openstreetmap.org/copyright), licence ODbL.
- Ciel HDR et textures : [Poly Haven](https://polyhaven.com), CC0.
- Moteur 3D : [three.js](https://threejs.org), licence MIT.
- Voix du moniteur : synthèse [ElevenLabs](https://elevenlabs.io) (voix « Bastien », modèle multilingue v2).
