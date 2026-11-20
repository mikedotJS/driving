# Code de la route — research file for the driving-school simulator (Paris / Montreuil)

State of the law checked on **2026-11-20**. Scope: permis B, car driver, urban driving.

## 0. Method and reliability (read first)

- **Direct page fetching was blocked in this session.** `legifrance.gouv.fr`, `service-public.gouv.fr`, `securite-routiere.gouv.fr`, `paris.fr`, `montreuil.fr`, `justice.fr`, `cerema.fr` are outside the session's network allowlist (proxy 403 / DNS refusal). Every source below was therefore consulted **through the web-search tool's extracts of the page**, not by reading the full page. Several Légifrance extracts were stamped "version en vigueur au 13–19/11/2026".
- Status tags used in every row:
  - **[L]** = Légifrance page, extract read via search.
  - **[O]** = other official site (service-public, Sécurité routière, Intérieur, paris.fr, montreuil.fr, Cerema, EUR-Lex…), extract read via search.
  - **[S]** = reputable secondary source (driving-school publishers, legal press, Banque des Territoires, etc.), extract read via search.
  - **[M]** = **UNVERIFIED (from memory)** — no source reached; treat as a hypothesis.
- Where a row carries two tags (e.g. [L]+[M]) the article and class were confirmed and the remaining detail (usually points or suspension in the *current* version) was not shown in the extract.
- "0" in a Points column means the offence does not appear in the official points list (A12, A13); it was not separately confirmed in the article text.
- Source keys (A1, B3…) refer to the URL lists at the end of each section.

### Fixed-fine amounts by class (used throughout) — [O][L] A14, A15

| Classe | Forfaitaire | Minorée | Majorée | Max (juge) |
|---|---|---|---|---|
| 1re | 11 € | — | 33 € | 38 € [M] |
| 2e | 35 € | 22 € | 75 € | 150 € [M] |
| 3e | 68 € | 45 € | 180 € | 450 € [M] |
| 4e | 135 € | 90 € | 375 € | 750 € [S] |
| 5e | 200 € (when forfaitisée; min. 150 / maj. 450) | | | 1 500 € |

No "minorée" for parking offences (art. 529-7 CPP) [M].

---

## 1. Infraction table (permis B, car driver)

### 1.1 Speeding (art. R413-14, L413-1) — thresholds apply to the *vitesse retenue* (after technical margin)

| Excess (vitesse retenue) | Article | Classe | Amende forfaitaire (min./maj.) | Points | Suspension | Status / sources |
|---|---|---|---|---|---|---|
| < 5 km/h, limit > 50 | R413-14 | 3e | 68 € (45/180) | **0** (since 1 Jan 2024) | no | [L][O] A1 A3 A4 A5 |
| < 5 km/h, limit ≤ 50 | R413-14 | 4e | 135 € (90/375) | **0** (since 1 Jan 2024) | no | [L][O] A1 A4 A5 |
| 5 to < 20 km/h, limit > 50 | R413-14 | 3e | 68 € (45/180) | 1 | no | [O] A1 A2 A12 |
| 5 to < 20 km/h, limit ≤ 50 | R413-14 | 4e | 135 € (90/375) | 1 | no | [O] A1 A2 A12 |
| 20 to < 30 km/h | R413-14 | 4e | 135 € (90/375) | 2 | no | [O] A2 A12 |
| 30 to < 40 km/h | R413-14 | 4e | 135 € (90/375) | 3 | up to 3 years | [O] A2 A12 |
| 40 to < 50 km/h | R413-14 | 4e | 135 € (90/375) | 4 | up to 3 years (immediate licence retention on interception [M]) | [O] A2 A12 |
| **≥ 50 km/h** | **L413-1** (R413-14-1 repealed) | **délit** (since 29 Dec 2025) | Court: up to **3 months' prison + 3 750 €**. Amende forfaitaire délictuelle **300 €** (min. 250 / maj. 600), available even in récidive | 6 | up to 3 years; vehicle confiscation possible (mandatory in récidive for the owner); ban on certain vehicles up to 5 years; criminal record | [L][O] A6 A7 A8 A9 |

Confirmations requested:
- **No point for an excess under 5 km/h since 1 Jan 2024: CONFIRMED.** Décret n° 2023-1150 du 6 décembre 2023 (JO 8 Dec 2023) amends R413-14; the fine remains (68 € or 135 €). [L][O] A4 A5
- **≥ 50 km/h is a délit from the first offence since 29 Dec 2025: CONFIRMED.** Loi n° 2025-622 du 9 juillet 2025 + décret n° 2025-1269 du 22 décembre 2025. Before that it was a 5th-class contravention (max 1 500 €) and a délit only in récidive. Some pages of service-public / Sécurité routière still show the old 1 500 € figure; ignore them. [L][O] A6 A7 A8 A9
- **Radar technical margin: CONFIRMED.** Fixed radars: minus 5 km/h below 100 km/h, minus 5 % above (97 measured → 92 retained). Radars in a moving vehicle: minus 10 km/h below 100 km/h, minus 10 % above. Legal basis: arrêté du 4 juin 2009, art. 6. [O][L] A10 A11

Instructor sentence: « La limitation est un maximum, pas un objectif : en ville c'est 50, et 30 partout où c'est signalé — ici, presque partout. »

### 1.2 Lights, priorities, intersections

| Infraction | Article | Classe | Amende (min./maj.) | Points | Suspension | Rule as an instructor says it | Status / sources |
|---|---|---|---|---|---|---|---|
| Feu rouge non respecté (fixe ou clignotant) | R412-30 | 4e | 135 € (90/375) | 4 | ≤ 3 ans | « Au rouge, arrêt absolu avant la ligne d'effet des feux ; sans ligne, avant le passage piéton ou à l'aplomb du feu. » | [L][O] A16 A12 |
| Feu jaune (orange) fixe non respecté | R412-31 | 2e | 35 € (22/75) | 0 | no | « L'orange, c'est l'arrêt, sauf si tu ne peux plus t'arrêter en sécurité. » | [L][S] A17 A18 |
| Feu jaune clignotant | R412-32 | — (no offence in itself) | — | — | — | « Jaune clignotant : passage autorisé avec prudence, la priorité est donnée par les panneaux, sinon priorité à droite. » | [S] A18 |
| Stop non respecté | R415-6 | 4e | 135 € (90/375) | 4 | ≤ 3 ans | « Au stop, les roues s'arrêtent complètement à la ligne, puis tu cèdes le passage des deux côtés. » | [L] A19 |
| Cédez-le-passage non respecté | R415-7 | 4e | 135 € (90/375) | 4 | ≤ 3 ans | « Cédez-le-passage : tu ralentis, tu regardes, tu ne passes que si tu ne gênes personne. » | [L][O] A20 A12 |
| Refus de priorité à droite | R415-5 | 4e | 135 € (90/375) | 4 | ≤ 3 ans [S] | « Sans signalisation, tu cèdes le passage à celui qui vient de ta droite. » | [L][S][O] A24 A12 |
| Refus de priorité dans un carrefour à sens giratoire | R415-10 | 4e | 135 € (90/375) | 4 | ≤ 3 ans [M] | « À l'entrée d'un giratoire, tu cèdes le passage à ceux qui sont déjà sur l'anneau. » (A "rond-point" without the giratoire sign, e.g. place de l'Étoile, stays priorité à droite [M].) | [L][O] A21 A12 |
| **Refus de priorité au piéton** | **R415-11** | 4e | 135 € (90/375) | **6 — CONFIRMED** | ≤ 3 ans | « Tu cèdes le passage, en t'arrêtant s'il le faut, au piéton engagé ou qui manifeste clairement son intention de traverser — et toujours en aire piétonne et zone de rencontre. » | [L][O] A22 A12 A13 |
| Refus de priorité à un véhicule d'intérêt général prioritaire | R415-12 | 4e | 135 € (90/375) | 4 | ≤ 3 ans | « Sirène et gyrophare : tu facilites le passage, sans te mettre en danger ni griller le feu. » (List of priority vehicles widened by décret 2026-652, see §2.) | [L] A23 |
| S'engager dans une intersection encombrée | R415-2 al. 1 | 4e | 135 € (90/375) | 0 [M] | no [M] | « Feu vert ou pas, tu ne t'engages que si tu peux dégager le carrefour. » | [L][S] A25 A65 |
| S'engager dans le sas vélo au risque d'y être immobilisé (feu vert, bouchon) | R415-2 al. 2 + R415-15 | 2e | 35 € (22/75) | 0 | no | « Le sas est aux cyclistes : si ça bouchonne, tu restes derrière la première ligne. » | [L][S] A25 A26 A32 |
| S'arrêter dans le sas vélo **au feu rouge** (first stop line crossed) | R412-30 | 4e | 135 € (90/375) | 4 | ≤ 3 ans | « Au rouge, ta ligne d'arrêt c'est la première, pas celle des vélos. » | [S] A32 A33 (one secondary source disagrees and says 35 €/0 pt; majority and the logic of R412-30 give 135 €/4 pts) |

### 1.3 Direction, lanes, lines

| Infraction | Article | Classe | Amende (min./maj.) | Points | Suspension | Rule as an instructor says it | Status / sources |
|---|---|---|---|---|---|---|---|
| Sens interdit | R412-28 | 4e | 135 € (90/375) | 4 | ≤ 3 ans | « Sens interdit : tu n'entres pas, même pour dix mètres. » | [L] A27 |
| Circulation à gauche sur chaussée à double sens (en marche normale) | R412-9 | 4e | 135 € (90/375) | 3 | ≤ 3 ans [M] | « Tu roules à droite, près du bord droit autant que la chaussée le permet. » | [L][O] A28 A12 |
| **Franchissement** d'une ligne continue | R412-19 | 4e | 135 € (90/375) | 3 | ≤ 3 ans | « Une ligne continue ne se franchit pas. » | [L][O] A29 A12 |
| **Chevauchement** d'une ligne continue | R412-19 | 4e | 135 € (90/375) | 1 | ≤ 3 ans | « …et ne se chevauche pas, sauf pour dépasser un cycliste si la visibilité le permet. » (Exception: straddling is allowed to overtake a cycle/EDPM under R414-4.) | [L][O] A29 A12 |
| Ligne de bande d'arrêt d'urgence franchie/chevauchée | R412-22 | 4e | 135 € | 1 | ≤ 3 ans | (R412-22 is the BAU line article, not the generic "chevauchement" one.) | [L] A30 |
| Circulation sur voie réservée (bus), piste/bande cyclable, trottoir, aire piétonne, voie verte | R412-7 | 4e | 135 € (90/375) | 0 | ≤ 3 ans (text) | « Couloir de bus, piste cyclable, trottoir : ce n'est pas ta voie, tu n'y roules pas et tu ne t'y arrêtes pas. » | [L][O] A31 (also the basis used for the Paris ZTL and the périphérique reserved lane) |
| Changement de direction (ou de file) sans avertir | R412-10 | 2e | 35 € (22/75) | 3 | ≤ 3 ans [L partial] | « Contrôle rétro, angle mort, clignotant — avant chaque changement de direction ou de file. » | [L][O] A34 A12 |
| Changement de file en circulation dense (files ininterrompues) hors préparation d'un changement de direction | R412-24 | 2e | 35 € (22/75) | 0 [M] | no | « En files ininterrompues, tu restes dans ta file. » | [L] A35 |
| Ne pas serrer à droite / franchir une ligne discontinue sans motif | R412-23 | 2e | 35 € | 0 [M] | no | « La voie normale, c'est celle de droite. » | [L] A36 |
| Non-respect de la distance de sécurité | R412-12 | 4e | 135 € (90/375) | 3 | ≤ 3 ans | « Garde au moins deux secondes derrière le véhicule qui te précède. » | [L][S][O] A37 A12 |

### 1.4 Overtaking

| Infraction | Article | Classe | Amende (min./maj.) | Points | Suspension | Rule | Status / sources |
|---|---|---|---|---|---|---|---|
| Dépassement dangereux / sans précautions; **distance latérale insuffisante** | R414-4 | 4e | 135 € (90/375) | 3 | ≤ 3 ans | « Pour dépasser un piéton, un cycliste, une trottinette : au moins 1 m en agglomération, 1,50 m hors agglomération. Si tu n'as pas la place, tu attends derrière. » — **1 m / 1,5 m CONFIRMED** | [L][O] A38 A12 |
| Dépassement par la droite | R414-6 | 4e | 135 € (90/375) | 3 (points list; not shown in current-text extract) | ≤ 3 ans | « On dépasse par la gauche ; par la droite seulement un véhicule qui a signalé qu'il tourne à gauche (ou un tram selon le cas). » | [L][O] A39 A12 |
| Dépassement interdit (intersection sans priorité, visibilité insuffisante, passage piéton engagé) | R414-10, R414-11 | 4e | 135 € | 3 | ≤ 3 ans | | [M] |
| Accélérer quand on est dépassé | R414-16 | 4e | 135 € | 2 | | « Quand on te dépasse, tu serres à droite et tu n'accélères pas. » | [O] A12 (article number [M]) |

### 1.5 Driver behaviour and equipment

| Infraction | Article | Classe | Amende (min./maj.) | Points | Suspension | Rule | Status / sources |
|---|---|---|---|---|---|---|---|
| Ceinture non attachée (conducteur) | R412-1 | 4e | 135 € (90/375) | 3 | no | « Avant de démarrer : ceinture, la tienne et celle de tes passagers mineurs. » | [L][O] A40 A12 |
| **Téléphone tenu en main** | R412-6-1 | 4e | 135 € (90/375) | 3 | **Yes** — see note | « Le téléphone en main, c'est non, même à l'arrêt au feu. » | [L][O] A41 A42 |
| Écouteurs, oreillette, casque audio | R412-6-1 | 4e | 135 € (90/375) | 3 | | « Rien dans les oreilles en conduisant (hors appareil auditif). » | [L][O] A41 A42 |
| Ne pas être en état/position d'exécuter les manœuvres (conduite sans les mains, champ de vision réduit…) | R412-6 | 2e | 35 € (22/75) | 0 | no; immobilisation possible | « Tu dois pouvoir manœuvrer à tout instant : deux mains disponibles, vision dégagée. » | [L] A64 |
| Circulation de nuit / par visibilité insuffisante **sans éclairage** | R416-11 | 4e | 135 € (90/375) | 4 | ≤ 3 ans | « La nuit, feux de croisement dès que tu roules. » | [L][O] A45 A12 |
| Mauvais usage des feux (pas de passage plein phares → croisement, etc.) | R416-4 s. | 4e | 135 € | 0 [M] | | « Tu repasses en croisement dès que tu risques d'éblouir. » | [L partial] A46 |
| Usage abusif de l'avertisseur sonore en agglomération | R416-1 | 2e | 35 € (22/75) | 0 | no | « En ville, le klaxon ne sert qu'en cas de danger immédiat. » | **[M]** (only the section heading R416-1 à R416-3 was reached, A46) |
| Vitesse excessive eu égard aux circonstances (défaut de maîtrise) | R413-17 | 4e | 135 € (90/375) | 0 | no [M] | « Tu adaptes ta vitesse : piétons, cyclistes, pluie, visibilité, rue étroite — même en dessous de la limite. » (2023 wording adds "voies adjacentes" and "obstacles prévisibles".) | [L] A47 |
| Vitesse anormalement réduite sans raison valable | R413-19 | 2e | 35 € (22/75) | 0 | no | « Rouler trop lentement sans raison gêne et se sanctionne aussi. » | [L] A48 |
| Ouverture de portière dangereuse | R417-7 | 1re | 11 € (maj. 33) | 0 | no | « Avant d'ouvrir : rétro, angle mort, et ouverture de la main opposée. » | [L] A63 |

**Phone and licence suspension (two layers):**
1. Since the décret of 18 May 2020 (in force 22 May 2020): phone in hand **plus** another moving offence at the same time (speed, priority, overtaking, lane, signalling…) → immediate licence retention and possible suspension. [O] A42 (Sécurité routière leaflet), date [M].
2. **New in autumn 2026:** by instruction of the Ministry of the Interior dated 29 Sept 2026, generalised from **5 Oct 2026**, prefects are asked to use **administrative suspension for the phone-in-hand offence alone** (no second offence needed); the prefect decides after the report, up to 6 months (press: typically 15 days to 1 month). Several départements already did so (e.g. Landes since 1 Nov 2025). [O] A43 A44

### 1.6 Stopping and parking

| Infraction | Article | Classe | Amende (maj.) | Points | Suspension | Rule | Status / sources |
|---|---|---|---|---|---|---|---|
| Arrêt/stationnement **gênant** (double file, bus stop, entrée carrossable, etc.) | R417-10 | 2e | 35 € (75) | 0 | no; fourrière possible | « Même "deux minutes", tu ne gênes pas la circulation. » | [L] A50 |
| Arrêt/stationnement **très gênant** (trottoir, passage piéton, piste/bande cyclable, voie verte, voie de bus, place PMR, **5 m en amont d'un passage piéton hors emplacement matérialisé**) | R417-11 | 4e | 135 € (375) | 0 | no; fourrière possible | « Jamais sur le trottoir, le passage piéton, la piste cyclable — ni dans les 5 mètres avant un passage piéton. » | [L][S] A51 A54 |
| Arrêt/stationnement **dangereux** (visibilité insuffisante près d'une intersection, d'un virage, d'un sommet de côte, d'un passage à niveau) | R417-9 | 4e | 135 € (375) | 3 | ≤ 3 ans | « Tu ne t'arrêtes pas là où on ne te voit pas arriver. » | [L][O] A49 A12 |

**5 m rule (LOM) — status:** two different rules are often confused.
- For **drivers**: stopping/parking within 5 m upstream of a pedestrian crossing, outside marked bays, is already "très gênant" under R417-11 (introduced by the 2015 PAMA decree [M]) → 135 €. The rule was read in the 2017 and 2022 versions of the article; the extract of the current version did not show that paragraph, and a 2026 secondary source still cites it. [L (2017 and 2022 versions)][S] A51 A54
- For **road authorities**: art. L118-5-1 code de la voirie routière (LOM 2019, art. 52) forbids *marked car parking bays* in those 5 m (bike/EDPM parking allowed); all crossings must comply by **31 Dec 2026**. No postponement found as of Nov 2026; compliance is uneven (Maire-info, 23 Jan 2026: "la date butoir approche dangereusement"). For the simulator: model no car bay in the last 5 m before a crossing. [S] A52 A53 A54

### 1.7 Délits (brief)

| Infraction | Article | Peine maximale | Points | Other | Status / sources |
|---|---|---|---|---|---|
| Délit de fuite | L231-1 (+ 434-10 code pénal) | 3 ans, 75 000 € | 6 | suspension/annulation (5 ans au plus [M]) | [L] A55 |
| Alcool 0,5 à < 0,8 g/L sang (0,25–0,40 mg/L air) ; **permis probatoire : dès 0,2 g/L** (0,10 mg/L air) | R234-1 | contravention 4e classe, 135 € (90/375) | 6 | suspension ≤ 3 ans; immobilisation | [O] A56 A12 |
| Alcool ≥ 0,8 g/L (0,40 mg/L air) ou ivresse manifeste ; refus de vérification | L234-1, L234-8 | **3 ans, 9 000 €** (was 2 ans / 4 500 € before 11 July 2025) | 6 | prefect suspension now mandatory; annulation en récidive | [O][L] A56 A57 A58 A60 |
| Conduite après usage de stupéfiants (analyse salivaire/sanguine) | L235-1 | **3 ans, 9 000 €** | 6 | prefect suspension mandatory | [L][O] A59 A60 |
| Stupéfiants **+** alcool | L235-1 | **5 ans, 15 000 €** | **9** (exception to the usual 8-point cap) | immobilisation + fourrière automatic | [O][S] A60 A13 |
| Conduite malgré usage **manifeste** de stupéfiants (no test needed) | **L237-1** (new, loi RIPOST, 20 Aug 2026) | délit (penalty not confirmed) | ? | | [S] B13 |
| Homicide routier / blessures routières | 221-18 s. code pénal | 7 ans, 100 000 € ; 10 ans, 150 000 € with ≥ 2 aggravating circumstances | 6 [M] | annulation obligatoire | [L][O] A60 A61 |

### Sources — section 1

- A1 service-public, "Vitesse au volant" (F19460): https://www.service-public.gouv.fr/particuliers/vosdroits/F19460
- A2 Sécurité routière, "Réglementation de la vitesse au volant": https://www.securite-routiere.gouv.fr/reglementation-liee-aux-risques/reglementation-de-la-vitesse-au-volant
- A3 Légifrance R413-14: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048533039
- A4 Décret n° 2023-1150 du 6 décembre 2023: https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000048530400
- A5 info.gouv.fr, fin du retrait de point: https://www.info.gouv.fr/actualite/permis-fin-du-retrait-de-point-pour-les-petits-exces-de-vitesse
- A6 Décret n° 2025-1269 du 22 décembre 2025: https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053157318
- A7 Légifrance L413-1: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000023718255/
- A8 Ministère de l'Intérieur, communiqué: https://www.interieur.gouv.fr/actualites/communiques-de-presse/tres-grand-exces-de-vitesse-devient-delit-a-partir-du-29-decembre-2025
- A9 service-public, "Le grand excès de vitesse est désormais un délit" (A18723): https://www.service-public.gouv.fr/particuliers/actualites/A18723
- A10 Sécurité routière, radars fixes (marge): https://www.securite-routiere.gouv.fr/radars/differents-types-de-radars/radars-fixes/radars-de-controle-de-la-vitesse-fixes
- A11 Arrêté du 4 juin 2009, art. 6: https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000020779832
- A12 Sécurité routière, barème des retraits de points: https://www.securite-routiere.gouv.fr/le-permis-points/infractions-et-retrait-de-points/bareme-des-retraits-de-point
- A13 service-public, barème des points (F31551): https://www.service-public.gouv.fr/particuliers/vosdroits/F31551
- A14 service-public, paiement de l'amende (F18509): https://www.service-public.gouv.fr/particuliers/vosdroits/F18509
- A15 Légifrance, R49 code de procédure pénale: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041765693
- A16 R412-30: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000039478725
- A17 R412-31: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842154
- A18 Digischool, feu orange clignotant (cites R412-32): https://www.digischool.fr/articles/auto/panneaux-et-signalisation/feu-orange-clignotant-code-de-la-route/
- A19 R415-6: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842245
- A20 R415-7: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842246
- A21 R415-10: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842250
- A22 R415-11: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000037411323
- A23 R415-12: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842252/
- A24 LegiPermis, priorité à droite (R415-5): https://www.legipermis.com/infractions/non-respect-de-priorite-a-droite.html
- A25 R415-2: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000039278127/
- A26 R415-15: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000039278141/
- A27 R412-28: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842149
- A28 Légifrance, section R412-6 à R412-16 (R412-9): https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006074228/LEGISCTA000006177121/
- A29 R412-19: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045025516
- A30 R412-22: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000025111525
- A31 R412-7: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047794459
- A32 Digischool, SAS vélo: https://www.digischool.fr/articles/auto/marquages-au-sol/sas-velo-code-de-la-route/
- A33 Lyon Capitale, sas vélo: https://www.lyoncapitale.fr/actualite/cette-infraction-souvent-oubliee-a-lyon-qui-peut-couter-cher
- A34 R412-10: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842127
- A35 R412-24: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842144
- A36 R412-23: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842143
- A37 R412-12: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051682619
- A38 R414-4: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842216
- A39 R414-6: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842219/
- A40 R412-1: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000037411287
- A41 R412-6-1: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041910422
- A42 Sécurité routière, téléphone au volant: https://www.securite-routiere.gouv.fr/reglementation-liee-aux-risques/reglementation-du-telephone-au-volant (leaflet: https://www.securite-routiere.gouv.fr/sites/default/files/2024-05/231012_depliant_smartphone_v1.pdf)
- A43 service-public, téléphone et suspension administrative (A19086): https://www.service-public.gouv.fr/particuliers/actualites/A19086
- A44 Ministère de l'Intérieur, généralisation de la suspension: https://www.interieur.gouv.fr/actualites/actualites-du-ministere/telephone-au-volant-zoom-sur-generalisation-de-suspension-du-permis-de-conduire
- A45 R416-11: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842269
- A46 Légifrance, éclairage (R416-4 à R416-16): https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006074228/LEGISCTA000006177133/ ; avertisseurs (R416-1 à R416-3): https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006074228/LEGISCTA000006177132/
- A47 R413-17: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047794480
- A48 R413-19: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842210
- A49 R417-9: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842293
- A50 R417-10: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045025551
- A51 R417-11: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047794500
- A52 Maire-info, passages piétons (23 Jan 2026): https://www.maire-info.com/am%C3%A9nagement/securisation-des-passages-pietons-la-date-butoir-approche-dangereusement-article-30404
- A53 Banque des Territoires, places aux abords des passages piétons: https://www.banquedesterritoires.fr/suppression-des-places-de-stationnement-aux-abords-des-passages-pour-pietions-quelle-reglementation
- A54 Digischool, stationnement à moins de 5 m: https://www.digischool.fr/articles/auto/arret-et-stationnement/stationnement-passage-pieton-5-metres/
- A55 L231-1: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051877424
- A56 service-public, alcool au volant (F2881): https://www.service-public.gouv.fr/particuliers/vosdroits/F2881
- A57 L234-1: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051877291
- A58 Sécurité routière, alcool: https://www.securite-routiere.gouv.fr/reglementation-liee-aux-risques/reglementation-de-lalcool-au-volant
- A59 L235-1 (version 11 July 2025): https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051877265/2025-07-11
- A60 Sécurité routière, entrée en vigueur de la loi homicide routier: https://www.securite-routiere.gouv.fr/actualites/entree-en-vigueur-de-la-loi-creant-lhomicide-routier-et-visant-lutter-contre-les
- A61 Vie-publique, loi du 9 juillet 2025: https://www.vie-publique.fr/loi/292845-creation-dun-homicide-routier-securite-routiere-loi-du-9-juillet-2025
- A62 Loi n° 2025-622: https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000051871463
- A63 R417-7: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006842289
- A64 R412-6: https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000019277061/
- A65 Roole, carrefour saturé: https://media.roole.fr/quotidien/reglementation/ce-que-vous-risquez-si-vous-avancez-dans-un-carrefour-deja-sature

---

## 2. Recent changes 2023 → Nov 2026 that matter for a learner driver

| Date in force | Change | Text | What it means in the simulator | Status / sources |
|---|---|---|---|---|
| 8 July 2023 | "Décret de l'été": R413-17 (adapt speed also to adjacent lanes / foreseeable obstacles); stopping or parking on reserved lanes = très gênant (135 €) | Décret n° 2023-563 du 5 juillet 2023 | Score "vitesse inadaptée" near queues of stopped vehicles and vulnerable users | [L][S] A47 B20 |
| 1 Sept 2023 [date M] | EDPM (trottinettes): minimum age raised 12 → 14; heavier fines (e.g. 135 € for carrying a passenger or riding on the pavement) | Décret n° 2023-848 du 31 août 2023 | NPC scooter riders are 14+; they use cycle lanes / roads ≤ 50 km/h | [O][S] B6 |
| 1 Jan 2024 | No point for speeding < 5 km/h (fine kept) | Décret n° 2023-1150 | See §1.1 | [L][O] A4 A5 |
| 1 Jan 2024 | **Permis B at 17** (driving alone at 17); AAC still from 15 | Décret n° 2023-1214 du 20 décembre 2023 | Candidate age ≥ 17 for the practical exam | [L][O] B1 B2 |
| 14 Feb 2024 | Digital driving licence in the France Identité app, accepted at roadside checks in France (complements, does not replace, the card) | — | Cosmetic (document check scene) | [O] B3 |
| 1 Mar 2024 | Automatic-gearbox licence (code 78): the 7 h manual-gearbox course can be taken immediately (3-month wait removed) | Arrêté du 15 février 2024 | Relevant if the simulator offers BVA/BVM tracks | [O][L] B4 |
| 1 Apr 2024 | End of the green insurance card and windscreen sticker; insurance checked in the Fichier des véhicules assurés; "mémo véhicule assuré" | Décret published 9 Dec 2023 | No insurance sticker on the 3D windscreen | [O] B5 |
| 1 Oct 2024 (inner ring) / 10 Oct 2024 (whole) | Paris périphérique 70 → 50 km/h | Arrêté municipal du 30 septembre 2024 | See §3 | [O] C5 C6 |
| 5 Nov 2024 | Zone à trafic limitée Paris Centre | Arrêté conjoint n° 2024P16495 | See §3 | [O] C9 C10 |
| End Nov 2024 | Cycles and EDPM may fit brake lights and **indicators**; two scooters may ride abreast on voies vertes, aires piétonnes, zones de rencontre | Décret n° 2024-1074 du 27 novembre 2024 | Bikes/scooters may show flashing indicators | [S] B7 |
| 1 Jan 2025 | ZFE Métropole du Grand Paris extended to Crit'Air 3 — but **no fines** (pedagogical phase prolonged to 31 Dec 2026) | Arrêté AP/2024/415 (MGP) | No driving consequence | [O][S] C12 C13 |
| 11 Jan 2025 | **Inter-file riding by motorcycles legalised nationwide** (2- and 3-wheelers ≤ 1 m wide, between the two leftmost lanes, when traffic is in uninterrupted files, ≤ 50 km/h, on roads with at least 2×2 lanes separated by a central reservation) | Décret n° 2025-33 du 9 janvier 2025 | Expect motorbikes filtering between the left lanes; check mirrors/blind spot before any lane change in congestion | [O][S] B8 B9 |
| 3 Mar 2025 (fines from 2 May 2025) | Reserved lane (lozenge) on the périphérique; also on A1/A13 | Arrêtés Ville de Paris / État | See §3 | [O] C7 C8 |
| 11 July 2025 | **Loi "homicide routier"** n° 2025-622 du 9 juillet 2025: new offences homicide routier / blessures routières; alcohol and drug délits raised to 3 ans / 9 000 €; alcohol + drugs 5 ans / 15 000 € and **9 points**; mandatory prefect suspension; licence retention after an injury accident pending a medical check; ≥ 50 km/h speeding becomes a délit (applied by decree in Dec.) | Loi n° 2025-622 | Penalty tables | [L][O] A60 A61 A62 |
| 25 Nov 2025 | **EU directive (UE) 2025/2205** on driving licences enters into force (OJ 5 Nov 2025). Transposition deadline **26 Nov 2028**, application about one year later. Contents: licence validity capped at 15 years for cars/motorbikes, digital licence, minimum 2-year probationary period, EU-wide accompanied driving at 17, medical check or self-assessment at issue/renewal. **Nothing has changed yet in France.** | Directive 2025/2205 | None before 2028–2029 | [O][S] B10 B11 B12 |
| 29 Dec 2025 | **Speeding ≥ 50 km/h = délit from the first offence** (3 months, 3 750 €; AFD 300 €) | Décret n° 2025-1269 | See §1.1 | [L][O] A6–A9 |
| 1 May / 1 July 2026 | Theory exam (ETG): anti-fraud organisation rules — registration closes the day before, no same-day retake. Content unchanged (40 questions, 35 to pass, 30 €) | Arrêté du 16 avril 2026 | None for driving | [S] B14 |
| 21 May 2026 | **ZFE not abolished**: the Conseil constitutionnel (décision n° 2026-903 DC) struck the ZFE-abolition article out of the "simplification" law as a cavalier législatif. ZFE remain in law | — | None; Crit'Air sticker still exists | [S] B15 |
| 25 July 2026 | **More priority vehicles**: R311-1 (6.5) rewritten, list of "véhicules d'intérêt général prioritaires" goes from 7 to 10 categories (e.g. on-call prosecutors' vehicles, SNCF/RATP dog-detection units). R415-12 obligation unchanged | Décret n° 2026-652 du 22 juillet 2026 | More vehicle types may run blue lights + siren | [S] B16 |
| 28 July 2026 | The lozenge signage for reserved lanes is still legally an **experiment** (arrêté du 24 août 2020), prolonged again by 3 months | Arrêté du 28 juillet 2026 | Model it anyway: it is in use on the périphérique | [S][L] B17 B18 |
| 20 Aug 2026 | **Loi RIPOST** n° 2026-798 du 18 août 2026 (JO 19 Aug): new délit of driving despite *manifest* drug use (L237-1); prefect may suspend the licence up to 6 months for repeated drug use even without driving; fixed fine for drug use 200 → 500 €; licence retention and mandatory vehicle confiscation for refus d'obtempérer; confiscation as the rule for rodéos. **Struck down** (Cons. const. n° 2026-915 DC, 14 Aug 2026): the ban on powerful cars for probationary drivers | Loi n° 2026-798 | No power restriction for novice drivers | [O][S] B13 B19 |
| 5 Oct 2026 | Phone in hand alone can lead to administrative licence suspension everywhere | Instruction du 29 septembre 2026 | See §1.5 | [O] A43 A44 |
| 31 Dec 2026 | Deadline: no car parking bay within 5 m upstream of pedestrian crossings | L118-5-1 CVR (LOM) | See §1.6 | [S] A52–A54 |

Checked and found **unchanged** as of Nov 2026:
- **Practical exam (permis B)**: no reform in force. A DSR working group (since Dec 2025 / early 2026) is reviewing which errors should stay eliminatory; an IGA report "Réformer l'apprentissage et l'examen du permis de conduire" is dated April 2026; no decision published. [S][O] B21 B22
- **Licence validity / medical visit**: no periodic medical visit and no limited validity for the right to drive in France yet (EU directive not transposed). [S] B12
- **Blind-spot stickers** ("Attention angles morts") on vehicles > 3.5 t: mandatory since 1 Jan 2021 (not a 2023–2026 change). 25 × 17 cm stickers on both sides at the front and at the rear right, 0.90–1.50 m above ground. Worth modelling on trucks and buses. [O] B23
- **Probationary licence**: 3 years (2 after AAC); 0.2 g/L alcohol. [S][O] B12 A56

Not confirmed (single commercial sources): end of CPF funding for the permis B in the 2026 finance law; any change to the probationary period.

### Sources — section 2

- B1 Décret n° 2023-1214: https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000048604456
- B2 Sécurité routière, permis à 17 ans: https://www.securite-routiere.gouv.fr/actualites/permis-b-lage-minimal-legal-pour-conduire-est-abaisse-17-ans
- B3 Intérieur, permis numérique: https://www.interieur.gouv.fr/actualites/communiques-de-presse/generalisation-de-lapplication-france-identite-et-lancement-du ; service-public A17159: https://www.service-public.gouv.fr/particuliers/actualites/A17159
- B4 Sécurité routière, boîte manuelle: https://www.securite-routiere.gouv.fr/actualites/acces-immediat-la-formation-boite-manuelle-pour-un-titulaire-du-permis-boite-automatique ; arrêté: https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000049156323
- B5 economie.gouv.fr, carte verte: https://www.economie.gouv.fr/actualites/assurance-automobile-suppression-carte-verte-avril-2024 ; Sécurité routière: https://www.securite-routiere.gouv.fr/actualites/compter-du-1er-avril-2024-la-carte-verte-et-la-vignette-disparaissent-des-vehicules
- B6 service-public, trottinettes/EDPM (F35470): https://www.service-public.gouv.fr/particuliers/vosdroits/F35470
- B7 Landot avocats, décret 2024-1074: https://blog.landot-avocats.net/2024/12/03/velo-edpm-feu-vert-pour-les-clignotants/
- B8 service-public, inter-files (A17992): https://www.service-public.gouv.fr/particuliers/actualites/A17992
- B9 Banque des Territoires, inter-files: https://www.banquedesterritoires.fr/un-decret-encadre-la-circulation-en-inter-files-des-deux-roues
- B10 EUR-Lex, directive 2025/2205: https://eur-lex.europa.eu/eli/dir/2025/2205/oj/eng/pdf
- B11 European Commission, entry into force: https://transport.ec.europa.eu/news-events/news/modernised-eu-rules-driving-licences-and-driving-disqualifications-enter-force-2025-11-25_en
- B12 service-public, réforme européenne (A18566): https://www.service-public.gouv.fr/particuliers/actualites/A18566 ; Digischool: https://www.digischool.fr/articles/auto/actualites/fin-du-permis-a-vie-reforme-europeenne/
- B13 Banque des Territoires, loi RIPOST: https://www.banquedesterritoires.fr/rodeos-mortiers-protoxyde-dazote-rave-parties-la-loi-ripost-entre-en-vigueur ; Intérieur: https://www.interieur.gouv.fr/actualites/actualites-du-ministere/loi-ripost-avancee-majeure-pour-securite-des-francais ; L237-1 commentary: https://consultation.avocat.fr/barreau-brest/blog/sophie-dubos/article-2983640-loi-ripost-conduire-sous-l-emprise-manifeste-de-stupefiants-devient-un-delit-meme-sans-analyse.html
- B14 Digischool, examen du code au 1er juillet 2026: https://www.digischool.fr/articles/auto/actualites/examen-code-de-la-route-1er-juillet-2026/
- B15 LCP, censure de la suppression des ZFE: https://lcp.fr/actualites/zfe-le-conseil-constitutionnel-censure-la-suppression-des-zones-a-faibles-emissions ; Banque des Territoires: https://www.banquedesterritoires.fr/loi-de-simplification-les-zfe-remises-en-piste-apres-la-decision-du-conseil-constitutionnel
- B16 Landot avocats, décret 2026-652: https://blog.landot-avocats.net/2026/07/26/elargissement-de-la-categorie-des-vehicules-dinteret-general-prioritaires/ ; Digischool: https://www.digischool.fr/articles/auto/regles-de-priorite/vehicules-prioritaires-code-de-la-route/
- B17 Banque des Territoires, prolongation de l'expérimentation: https://www.banquedesterritoires.fr/voies-reservees-sur-certains-axes-routiers-lexperimentation-de-la-signalisation-prolongee-de-trois
- B18 Arrêté du 24 août 2020: https://www.legifrance.gouv.fr/loda/id/JORFTEXT000042283775/ ; ministère: https://www.ecologie.gouv.fr/politiques-publiques/voies-reservees-axes-routiers-structurants
- B19 Motor1, censure "voitures puissantes": https://fr.motor1.com/news/805406/loi-ripost-censure-conseil-constitutionnel-2026/ ; Digischool: https://www.digischool.fr/articles/auto/reglementation/loi-ripost-permis-de-conduire/
- B20 Automobile Club, décret de l'été 2023: https://www.automobile-club.org/actualites/l-auto-et-la-loi/securite-et-circulation-routieres-decret-de-l-ete
- B21 Le Repaire des Motards, groupes de travail DSR: https://www.lerepairedesmotards.com/actualites/2026/securite-routiere-groupes-travail-permis-conduire.php ; Leocare: https://leocare.eu/fr/blog/fautes-eliminatoires-bientot-acceptees-examen-permis-de-conduire/
- B22 Rapport IGA (avril 2026): https://www.vie-publique.fr/files/rapport/pdf/304214.pdf
- B23 Sécurité routière, angles morts: https://www.securite-routiere.gouv.fr/actualites/les-vehicules-lourds-doivent-desormais-etre-equipes-dune-signalisation-materialisant ; guide: https://www.securite-routiere.gouv.fr/sites/default/files/2021-01/2110126_dsr_guide_angles_morts_04.pdf

---

## 3. Local rules

### 3.1 General rules in agglomération

| Rule | Article | Content | Status / sources |
|---|---|---|---|
| Default limit | R413-3 | 50 km/h in agglomération. The article still states **70 km/h for the boulevard périphérique de Paris** (the 50 km/h there comes from the municipal arrêté, which is stricter). Possible raise to 70 km/h on protected sections [M]. | [S] C1 |
| Zone 30 | R110-2 | Area open to all users, 30 km/h; entries/exits signed; carriageways are two-way for cyclists unless the police authority decides otherwise | [L] C2 |
| Zone de rencontre | R110-2 | 20 km/h; **pedestrians may walk on the carriageway and have priority over vehicles** (without loitering); two-way for cyclists; parking only on marked bays [M] | [L] C2 |
| Aire piétonne | R110-2 | Pedestrians only; authorised service vehicles at walking pace; pedestrians have priority | [L] C2 |
| **Double-sens cyclable** | R412-28-1 | On every road limited to **30 km/h or less**, one-way streets are two-way for cyclists, EDPM and light cyclomobiles, unless decided otherwise. In a one-way zone-30 street expect bikes coming towards you, including at junctions (look both ways when emerging). | [L] C3 |
| Priority to pedestrians | R415-11 | 6 points (see §1.2) | [L] A22 |

### 3.2 Paris

| Topic | Rule | Status / sources |
|---|---|---|
| **General 30 km/h** | Since **30 Aug 2021**, 30 km/h on almost all Paris streets | [O][S] C4 |
| Streets kept at 50 km/h | Boulevards des Maréchaux, avenue des Champs-Élysées, avenue Foch, avenue de la Grande-Armée, rue Royale, some roads in the bois de Boulogne and bois de Vincennes, some quay sections and a few axes (cited: place de la Porte-Maillot, avenue du Général-Leclerc, cours de Vincennes, avenue de la Porte-de-Vincennes). The city's Nov 2025 signage guide calls 50 km/h "très exceptionnel" and cites the Maréchaux and the Champs-Élysées. **The full official list (per arrondissement, 2021) was not reached; use OSM `maxspeed` or the city list.** | [S][O] C4 C4b C14 |
| **Boulevard périphérique** | **50 km/h** since 1 Oct 2024 (inner carriageway), whole ring by 10 Oct 2024 (arrêté du 30 sept. 2024; one section excepted in the arrêté). Still 50 in Nov 2026; one press source reports the tribunal administratif de Paris upheld the limit on 13 Oct 2026 (single source). | [O][S] C5 C6 C15 |
| **Reserved lane (VR2+) on the périphérique** | Left lane, since **3 Mar 2025**, fines (135 €, R412-7) since **2 May 2025**. Active **Monday–Friday 7:00–10:30 and 16:00–20:00**, not at weekends or on public holidays; signalled by a **lit white lozenge** on variable signs (off = lane open to all; can be deactivated for incidents/congestion). Allowed: vehicles with ≥ 2 occupants, public transport, taxis, holders of a disabled card (CMI), emergency/health vehicles; motorcycles when filtering. HGVs > 3.5 t excluded. The southern section (quai d'Issy – porte de Bercy) is a later phase. Enforcement by video analysis + sworn officer. | [O] C7 C8 |
| **ZTL Paris Centre** | In force since **5 Nov 2024**, arrondissements 1–4, 24/7. **Through traffic by motor vehicles is forbidden**; access is allowed if you have a destination inside (residents, deliveries, shops, parking, taxis, buses, emergency…). Applies to electric cars too; bikes/scooters unaffected. **Still in "phase pédagogique": no fines as of the city page updated 28 Sept 2026** (start postponed several times; announced "2026"). Planned sanction: 135 € (4e classe). Exact perimeter exclusions (islands, quays, boundary boulevards) not verified. | [O][S] C9 C10 C11 |
| ZFE (Grand Paris, inside A86) | Crit'Air 3 and worse restricted since 1 Jan 2025, **no sanctions until 31 Dec 2026** | [O][S] C12 C13 |
| 2026 context | Emmanuel Grégoire elected mayor on 22 Mar 2026 (press); no official change to the 50 km/h périphérique, the reserved lane or the ZTL was found. Press reports mention ideas (variable 50–70 km/h limit, AI-driven traffic lights, 1 000 pedestrian streets by 2032) — not rules. | [S] C16 |
| Paris marking specifics | u = 6 cm on all intramuros roads; lane lines 2u = 12 cm (15 cm on the périphérique) | [O] C14 |

### 3.3 Montreuil (93100)

| Question | Finding | Status / sources |
|---|---|---|
| Is the whole commune 30 km/h? | **Not confirmed as 100 %.** The city's Plan vélo 2023–2026 speaks of "la mise en place généralisée de la zone 30 depuis plusieurs années"; a planning document (OAP) states the aim "mettre la ville intégralement en zone 30 hors axes structurants de grande circulation (limités à 50 km/h)"; local TV reports "plus de 80 % de ses rues en zone 30"; a radio report (ICI) calls Montreuil a "pionnière des 30 km/h" with the measure in place for about ten years. So: zone 30 is the norm, with exceptions. | [O][S] D1 D2 D3 D4 |
| Since when? | No founding arrêté or date found. A 2017 source says the city wanted the whole town in zone 30 by 2019; calming policy dates back to the 1990s. | [S] D5 D6 |
| Which roads stay at 50? | "Axes structurants de grande circulation" — not listed in any source reached. They are in practice the **routes départementales** managed by the Département de Seine-Saint-Denis (e.g. RD 20 boulevard/avenue Wilson, RD 37, RD 41, RD 902 are departmental roads in Montreuil), but **their current limits were not verified**; the Département's policy is to offer 30 km/h to communes when it rebuilds a road for cycling. | [O] D2 D7 D8 — street-by-street: **[M]/unverified** |
| Zones de rencontre (20 km/h) | Exist (the city has built zones 30 and zones de rencontre progressively); **no list found**. | [S] D6 |

Recommendation for the simulator: take `maxspeed`, `highway=living_street` (zone de rencontre) and `oneway:bicycle=no` tags from OpenStreetMap for Montreuil and spot-check against street imagery; default every unlisted Montreuil street to 30 km/h and every Paris street to 30 km/h.

### Sources — section 3

- C1 Weka (text of R413-3, version since 10 Jan 2014): https://www.weka.fr/base-juridique/code_CROUTE_LEGISCTA000006177128.html ; Digischool: https://www.digischool.fr/articles/auto/limitations-vitesse/limitation-de-vitesse-code-de-la-route/
- C2 R110-2: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045650507
- C3 R412-28-1: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000039278114
- C4 paris.fr, 30 km/h: https://www.paris.fr/pages/generalisation-de-la-vitesse-a-30-km-h-les-parisiens-ont-donne-leur-avis-16967 ; L'argus, rues restant à 50: https://www.largus.fr/actualite-automobile/paris-les-rues-qui-restent-limitees-a-50-kmh-10707399.html
- C4b Connexion France (list of 50 km/h axes, 2021): https://www.connexionfrance.com/article/French-news/Speed-limit-set-to-lower-to-30kph-in-most-of-Paris-from-August-30
- C5 paris.fr, 50 km/h sur le périphérique: https://www.paris.fr/pages/50-km-h-sur-le-peripherique-la-mesure-mise-en-place-le-1er-octobre-28673
- C6 Arrêté du 30 septembre 2024 (BOVP): https://bovp.apps.paris.fr/doc_num_data.php?explnum_id=30365
- C7 paris.fr, voie réservée: https://www.paris.fr/pages/la-voie-reservee-sur-le-peripherique-entre-en-vigueur-le-3-mars-30106
- C8 service-public, voie de covoiturage du périphérique (A18035): https://www.service-public.gouv.fr/particuliers/actualites/A18035
- C9 paris.fr, ZTL: https://www.paris.fr/pages/paris-cree-une-zone-apaisee-dans-le-centre-de-la-capitale-20426
- C10 Arrêté ZTL (BOVP): https://bovp.apps.paris.fr/doc_num_data.php?explnum_id=31507
- C11 Caradisiac, verbalisation ZTL repoussée: https://www.caradisiac.com/la-verbalisation-de-la-zone-a-trafic-limite-de-paris-repoussee-217604.htm
- C12 paris.fr, ZFE: https://www.paris.fr/zfe
- C13 Banque des Territoires, ZFE Grand Paris: https://www.banquedesterritoires.fr/zone-faibles-emissions-le-grand-paris-prolonge-dun-les-derogations-et-la-dispense-de-controle
- C14 Ville de Paris, Guide des signalisations verticale et horizontale, partie 1 (nov. 2025): https://cdn.paris.fr/paris/2025/11/28/guide-sh-sv-partie-1-principes-generaux-nov-2025-web-Py3O.pdf
- C15 Économie Matin, TA valide le 50 km/h: https://www.economiematin.fr/?p=233884
- C16 Mondial.paris, projet auto du maire: https://mondial.paris/actualites/auto-pratique/voiture-a-paris-en-2026-projet-auto-du-maire-emmanuel-gregoire-58487.html ; Polis: https://www.polisnetwork.eu/news/paris-reinforces-mobility-ambitions-through-new-political-mandate-and-measurable-initiatives/
- D1 Montreuil, Plan vélo 2023–2026: https://www.montreuil.fr/sites/default/files/medias/document/2025/05/montreuil_plan_velo_2023_2026.pdf
- D2 Montreuil, OAP (PLU): https://www.montreuil.fr/sites/default/files/typo3/fileadmin/user_upload/12_Environnement/06_Etat_des_lieux_de_l_environnement/06_Pollution_des_sols_et_de_l_eau/4.OAP-1.pdf
- D3 Via Grand Paris: https://www.viagrandparis.tv/zones-30-redefinissent-circulation-centres-villes-montreuil.html
- D4 ICI (Radio France): https://www.ici.fr/infos/transports/pionniere-des-30-km-h-en-ville-montreuil-ne-reviendrait-pour-rien-au-monde-en-arriere-3540942
- D5 Century 21 Montreuil (2017): https://www.century21-boissiere-montreuil.com/actus/1515333306/montreuil-zone-a-30/
- D6 Rue de l'Avenir, visite urbaine à Montreuil: https://www.ruedelavenir.com/rencontres/visite-urbaine-a-montreuil/
- D7 Montreuil, règlement de voirie (2023): https://www.montreuil.fr/sites/default/files/typo3/fileadmin/user_upload/03_Demarches/05_Urbanisme_Logement/reglement_voirie_DEL20231206.pdf
- D8 Seine-Saint-Denis, stratégie vélo départementale: https://ressources.seinesaintdenis.fr/IMG/pdf/6._stategie_velo_departementale.pdf

---

## 4. Permis B practical exam

### 4.1 Format — [L][O] E1 E2 E3

| Item | Value |
|---|---|
| Legal text | Arrêté du 19 février 2010 (modified 2014, 2017) |
| Total time per candidate | **32 minutes** (welcome, ID check, installation, briefing, **eyesight test**, driving, verifications) |
| Effective driving | **25 minutes minimum**, in and (where possible) out of agglomération |
| Autonomous driving | about **5 minutes**: follow a route/destination by yourself |
| Manoeuvres | **2**: (1) *freinage pour s'arrêter avec précision*; (2) one **reverse** manoeuvre among: marche arrière en ligne droite, marche arrière en arrondi/en angle, créneau, épi, bataille, demi-tour (list of six from a secondary source [S] E7) |
| Stationary questions | 1 vérification on a technical element **inside or outside** the vehicle + 1 road-safety question + 1 **first-aid** question (first aid added by arrêté du 6 octobre 2017) |
| Pass | **≥ 20 points out of 31 and no erreur éliminatoire** |
| Result | Certificat d'examen du permis de conduire (CEPC), available online after 48 h [M] |
| Minimum age | 17 (since 1 Jan 2024) |

### 4.2 Grading grid (CEPC) — total 31 — [S] E4 E5 E6 (structure also in the official 2018 evaluation guide [O] E8, whose table was not readable)

| Bloc | Compétence | Notation | Max |
|---|---|---|---|
| Connaître et maîtriser son véhicule | Savoir s'installer et assurer la sécurité à bord | 0–1–2 | 2 |
| | Connaître et utiliser les commandes | E–0–1–2–3 | 3 |
| | Effectuer des vérifications du véhicule (1 pt per correct answer: vérification, sécurité routière, premiers secours) | 0–1–2–3 | 3 |
| Appréhender la route | Prendre l'information | E–0–1–2–3 | 3 |
| | Adapter son allure aux circonstances | E–0–1–2–3 | 3 |
| | Appliquer la réglementation | E–0–1–2–3 | 3 |
| Partager la route avec les autres usagers | Communiquer avec les autres usagers | E–0–1–2–3 | 3 |
| | Partager la chaussée | E–0–1–2–3 | 3 |
| | Maintenir les espaces de sécurité | E–0–1–2–3 | 3 |
| Autonomie et conscience du risque | Analyse des situations | 0–0,5–1 | 1 |
| | Adaptation aux situations | 0–0,5–1 | 1 |
| | Conduite autonome | 0–0,5–1 | 1 |
| Bonus | Courtoisie au volant | 0–1 | 1 |
| | Conduite économique et respectueuse de l'environnement | 0–1 | 1 |
| | **Total** (8 + 9 + 9 + 3 + 2) | | **31** |

Level meaning [M]: 0 = not acquired, 1 = being acquired, 2 = acquired, 3 = mastered; E = eliminatory error. Which lines carry an "E" box and the 0.5 step are from memory [M]; the 2/3/3/…/1/1/1 + 1 + 1 split is confirmed by secondary sources.

### 4.3 Erreurs éliminatoires

- Official examples (service-public): **franchissement d'une ligne continue, circulation à gauche, non-respect d'un signal prescrivant l'arrêt** (feu rouge, stop). [O] E3
- Commonly listed by driving-school publishers: refus de priorité, circulation en sens interdit, non-respect d'un stop/feu rouge, franchissement de ligne continue, oubli grave de contrôle (angle mort) créant un danger, toute **intervention de l'expert** sur les commandes (volant, freins) or by voice to avoid danger, montée sur trottoir dangereuse. [S] E9
- Principle [M]: an action or omission that puts a user (including the exam car) in a situation where safety depends on the reaction of others, or a serious listed offence.
- The framework is described as "5 cas éliminatoires et 11 pré-définitions" for inspectors; a reform to keep only errors with real and immediate danger is under discussion, **not adopted** (see §2). [S] B21

### 4.4 REMC — the 4 competences used for lesson progression

Arrêté du 13 mai 2013 (référentiel) and livret d'apprentissage; 4 global competences and about 30 associated ones. Competence titles confirmed [S] E10 E11; **sub-skill wording below is from memory of the livret, cross-checked only in part against driving-school programmes [M]+[S]** (items marked * were matched in a source).

| Compétence | Sous-compétences |
|---|---|
| **1. Maîtriser le maniement du véhicule dans un trafic faible ou nul** | Connaître les principaux organes et commandes du véhicule, effectuer des vérifications intérieures et extérieures* · Entrer, s'installer au poste de conduite et en sortir* · Tenir, tourner le volant et maintenir la trajectoire* · Démarrer et s'arrêter* · Doser l'accélération et le freinage à diverses allures* · Utiliser la boîte de vitesses* · Diriger la voiture en avant en ligne droite et en courbe en adaptant allure et trajectoire* · Regarder autour de soi et avertir* · Effectuer une marche arrière et un demi-tour en sécurité |
| **2. Appréhender la route et circuler dans des conditions normales** | Rechercher la signalisation, les indices utiles et en tenir compte · Positionner le véhicule sur la chaussée et choisir la voie de circulation · Adapter l'allure aux situations · Détecter, identifier et franchir les intersections suivant le régime de priorité* · Tourner à droite et à gauche en agglomération* · Franchir les ronds-points et les carrefours à sens giratoire · S'arrêter et stationner en épi, en bataille et en créneau* |
| **3. Circuler dans des conditions difficiles et partager la route avec les autres usagers** | Évaluer et maintenir les distances de sécurité* · Croiser, dépasser, être dépassé* · Passer des virages et conduire en déclivité* · Connaître les caractéristiques des autres usagers et savoir se comporter à leur égard avec respect et courtoisie · S'insérer, circuler et sortir d'une voie rapide* · Conduire dans une file de véhicules et dans une circulation dense · Connaître les règles relatives à la circulation inter-files des motocyclistes et savoir en tenir compte · Conduire quand l'adhérence et la visibilité sont réduites · Conduire à l'abord et dans la traversée d'ouvrages routiers (tunnels, ponts…) |
| **4. Pratiquer une conduite autonome, sûre et économique** | Suivre un itinéraire de manière autonome* · Préparer et effectuer un voyage longue distance en autonomie · Connaître les principaux facteurs de risque au volant et les recommandations à appliquer · Connaître les comportements à adopter en cas d'accident : protéger, alerter, secourir · Faire l'expérience des aides à la conduite du véhicule (régulateur, limiteur de vitesse, ABS, aides à la navigation…) · Avoir des notions sur l'entretien, le dépannage et les situations d'urgence* · Pratiquer l'écoconduite* |

### Sources — section 4

- E1 Arrêté du 19 février 2010: https://www.legifrance.gouv.fr/loda/id/JORFTEXT000021897924
- E2 Sécurité routière, "Passer son permis B": https://www.securite-routiere.gouv.fr/les-differents-permis-de-conduire/permis-auto-categorie-b/passer-son-permis-b
- E3 service-public, permis B (F2828): https://www.service-public.gouv.fr/particuliers/vosdroits/F2828
- E4 Ornikar, grille d'évaluation: https://www.ornikar.com/permis/examen/passer-epreuve/notation/grille-evaluation
- E5 Codes Rousseau, grille 2026: https://public.codesrousseau.fr/conseils-pratiques/1090-la-grille-d-evaluation-du-permis-le-bareme-2026.html
- E6 LeComparateurAssurance, grille: https://www.lecomparateurassurance.com/assurance-auto/guides/permis-conduire/grille-evaluation-permis-conduire
- E7 Préfecture de Charente-Maritime, nouvelles dispositions permis B (modification 2014): https://www.charente-maritime.gouv.fr/contenu/telechargement/11139/65783/file/nouvelles%20dispositions%20permis%20B.pdf
- E8 Guide d'évaluation de l'épreuve pratique B (DSR, version 1er janvier 2018): https://saone-et-loire.gouv.fr/contenu/telechargement/11264/135367/file/guide_b_version_1er_janvier_2018.pdf
- E9 Le Permis Libre, erreurs éliminatoires: https://www.lepermislibre.fr/permis-conduire/examen-permis/erreur-eliminatoire-permis-b ; Ornikar: https://www.ornikar.com/permis/examen/passer-epreuve/notation/fautes-eliminatoires
- E10 Ornikar, REMC: https://www.ornikar.com/permis/pedagogie/remc (C1: https://www.ornikar.com/permis/pedagogie/remc/maitrise-vehicule)
- E11 En Voiture Simone, REMC C1–C4: https://www.envoituresimone.com/permis-de-conduire/conseils-conduite/remc/maitrise-vehicule ; ECF parcours de formation: https://www.ecf.asso.fr/storage/documents/network/134/parcours-de-formation-b.pdf

---

## 5. Signalling details for 3D modelling

The reference is the *Instruction interministérielle sur la signalisation routière* (IISR, arrêté du 24 novembre 1967 modifié). Current consolidated PDFs were located on the Cerema site (1re partie 4 Sept 2025, 6e partie 4 Sept 2025, 7e partie 4 Apr 2025) but could not be opened; the figures below come from the City of Paris signage guide (Nov 2025), a Métropole de Lyon technical sheet and secondary sources, or from memory where tagged.

### 5.1 Road markings (IISR 7e partie)

| Element | Value | Status / sources |
|---|---|---|
| Unit width "u" | 7.5 cm on motorways / dual carriageways; 6 cm on major roads; 5 cm on all other roads; 3 cm on cycle tracks. **Paris intramuros: u = 6 cm everywhere.** Montreuil: 5 or 6 cm (not verified; departmental roads likely 6) | [O] C14 |
| Colour | White (yellow for temporary works, bus-stop zigzag and no-stopping kerb lines; blue for zone bleue) | [M] |

Dash patterns (multiples of 13 m) — [O] C14:

| Type | Trait | Intervalle | Typical use |
|---|---|---|---|
| T1 | 3 m | 10 m | axis / lane lines on long sections (2u) |
| T'1 | 1.5 m | 5 m | lane lines in town on short sections (2u) — the usual Paris choice |
| T2 | 3 m | 3.5 m | edge lines; entry/exit lanes |
| T'2 | 0.5 m | 0.5 m | transverse lines (cédez-le-passage, ligne d'effet des feux), guidance in junctions, parking delimitation |
| T3 | 3 m | 1.33 m | warning lines before a continuous line; approach to junctions with arrows; separation of bus/cycle lanes |
| T'3 | 20 m | 6 m | hard-shoulder edge |
| T4 | 39 m | 13 m | motorway hard-shoulder edge |

Widths and transverse marks:

| Element | Value | Status / sources |
|---|---|---|
| Lane line / axis line | 2u → **12 cm in Paris** (15 cm on the périphérique), 10 cm where u = 5 | [O] C14 |
| Bus-lane / cycle-lane separation | continuous or T3, **5u** (30 cm in Paris) | [O] C14 |
| **Stop line** | continuous, **50 cm** wide, across the lanes concerned | [S] F5 (IISR text not read) |
| **Cédez-le-passage line** | T'2 (50 cm dash / 50 cm gap), **50 cm** wide; 25 × 25 cm on cycle tracks | [O] C14 |
| **Ligne d'effet des feux** | T'2 (50/50 cm), **15 cm** wide; in Lyon drawn 4 m before the pedestrian crossing and parallel to it | [O] C14 F1 |
| Guidance lines inside junctions | T'2, 10 cm (Paris) | [O] C14 |
| **Passage piéton** | bands parallel to the road axis, **50 cm wide** [M], spaced **50 to 80 cm**, **minimum length 2.50 m in town** (4 to 6 m in rural areas) | [O] F4 |
| **Sas vélo** | zone between the ligne d'effet des feux (cars) and the cyclists' line/crossing, **3 to 5 m deep** (4 m in Lyon practice), one bike pictogram facing each car lane; where there is a cycle lane the LEF is not drawn across it | [O][S] F1 F6 (IISR art. 118-1 not read) |
| Parking bay lines | 2u, T'2 for outer delimitation of reserved zones (Paris) | [O] C14 |
| No parking bay in the last 5 m before a pedestrian crossing | see §1.6 | [S] A52 |

### 5.2 Traffic lights (IISR 6e partie)

| Element | Value | Status / sources |
|---|---|---|
| Families | Intersection signals **R11 to R19**: R11 tricolore circulaire; **R12 piétons** (red/green figure, two lights); R13 tricolore modal (R13b bus, R13c vélo); R14 tricolore directionnel (arrows); R15/R16 anticipation (flashing yellow modal/arrow) ; R17/R18 public-transport signals; R19 cyclist give-way signals. Others: R1 flashing yellow beacon [M], R21 lane-allocation (red cross / green arrow) [M], R22/R23 flow control, **R24 red flashing = absolute stop** (level crossing, tram, bridge) | [O] F2 F3 (R15–R19, R1, R21 details [M]) |
| R11 variants | R11v: green at the bottom; R11j: flashing yellow at the bottom instead of green | [M] |
| Sequence | green → fixed yellow → red → green (no red+yellow phase). Fixed yellow 3 s in town, 5 s out of town | [M] |
| Maximum red waiting time | 120 s | [O] F2 |
| **Position** | **Before the junction**, on the right of the carriageway at the stop line (ligne d'effet des feux); no far-side signal. The first driver therefore cannot see the main head, hence the **small low repeater** on the same pole at driver's-eye height (about 1–1.5 m), facing the stopped car. Left-side or overhead (potence) repeat on wide roads. Main head about 2.3–3.5 m above the pavement; lenses 200 mm (300 mm on fast or overhead signals) | **[M]** (IISR art. 110 not read; no French source reached for heights) |
| Pedestrian signal R12 | red figure above green figure (or red left / green right when horizontal); facing the crossing on the far kerb; **must now have an audible repeater**; optional countdown timers allowed since the arrêté du 13 juin 2022 | [O] F3 F7 (layout from IISR extract "vert et rouge … de droite à gauche") |
| Flashing yellow | means "caution, lights not regulating": apply signs, otherwise priorité à droite (R412-32). Whole junction switched to flashing yellow at night in many towns | [S] A18 |
| Cyclist exemptions at lights | M12 panels (small yellow bike + arrow under the light) let cyclists treat the red as a give-way for the shown movement — drivers must expect bikes moving on red | [M] |

### 5.3 Vertical signs (IISR 1re partie, art. 5-3 and 9)

| Element | Value | Status / sources |
|---|---|---|
| Size ranges | Seven ranges from "miniature" to "exceptionnelle"; **normale** is the default; **petite** where normale cannot be installed (narrow urban streets, trees…); **miniature** only in agglomération and tunnels | [S] F8 |
| Triangle (type A, AB3a) side | miniature 500 · **petite 700** · normale 1000 · grande 1250 · très grande 1500 mm | [S] F9 (500 and ≥1250 [M]) |
| Disc (type B, most C) diameter | miniature 450 · **petite 650** · normale 850 · grande 1050 · très grande 1250 mm | [S] F9 |
| Square (type C, AB6) side | miniature 350 [M] · **petite 500** · normale 700 · grande 900 [M] · très grande 1050 [M] mm | [S] F9 |
| Octagon (AB4 stop) | miniature 400 · **petite 600** · normale 800 · grande 1000 mm | **[M]** |
| Typical in Paris / Montreuil streets | petite gamme (700 / 650 / 600 / 500), miniature in constrained streets | [M] |
| Mounting height | In principle 1 m above ground out of town; **in agglomération with street lighting, up to 2.30 m** (under the lowest sign) so that pedestrians pass underneath and parked vehicles do not hide it | [S] F10 (IISR art. 9 quoted on a forum) |
| Lateral position | edge of sign ≥ 0.70 m from the carriageway edge [M] | [M] |
| Reserved-lane sign | square variable sign with a **white lozenge**; lit = lane reserved | [O] C7 |
| Zone signs | B30 (zone 30 entry), B51 (end), B52/B53 zone de rencontre, B54/B55 aire piétonne | [M] |

### Sources — section 5

- F1 Métropole de Lyon, fiche "Ligne d'effet des feux / sas vélo": https://labdesespacespublics.grandlyon.com/app/uploads/2024/07/2019-04-RFX-ligne-deffet-des-feux-sas-velo-MAJjuin2017.pdf
- F2 IISR 6e partie (Cerema, 4 Sept 2025): https://equipementsdelaroute.cerema.fr/IMG/pdf/iisr_6epartie_vc_20250904.pdf
- F3 Arrêté du 13 juin 2022 modifiant l'IISR (Cerema copy): https://equipementsdelaroute.cerema.fr/IMG/pdf/arr_2022_13_juin_modif_iisr_cle2af221.pdf
- F4 Réponse ministérielle citing IISR art. 118 (passages piétons): https://questions.assemblee-nationale.fr/dyn/13/questions/QANR5L13QE36859.pdf
- F5 Codes Rousseau / Ornikar, marquage au sol: https://www.ornikar.com/code/cours/signalisation/marquage-sol ; https://public.codesrousseau.fr/conseils-pratiques/885-panneau-cedez-le-passage-et-marquage-au-sol.html
- F6 Matmut, sas vélo (3 to 5 m): https://www.matmut.fr/assurance/nvei/conseils/sas-velo
- F7 Cerema, note technique R12m: https://equipementsdelaroute.cerema.fr/IMG/pdf/note_technique_r12m_signal_mixte_pieton_14102024_cle5a3aff.pdf
- F8 Ornikar, dimensions des panneaux: https://www.ornikar.com/code/cours/panneaux/differentes-dimensions
- F9 Supplier documentation reproducing the ranges (petite 700/650/500, normale 1000/850/700; type B 450–650–850–1050–1250). The search tool attributed these figures to supplier pages without saying which page carries which figure; candidates: https://www.hellopro.fr/signaux-d-indication-type-c-2017876-9162776-produit.html and https://www.hellopro.fr//documentation/pdf_prod/8/6/3/549576action=integrer_produits_3cb4c12b52963801157a591ed708cd84_5770368.pdf — treat as secondary, confirm in IISR 1re partie art. 5-3
- F10 L'argus forum quoting IISR art. 9: https://www.largus.fr/forum-auto/droit-penal-routier-code-de-la-route/hauteur-maximale-du-panneau/51488.html
- Not opened, to consult once the hosts are allowed: IISR 7e partie https://equipementsdelaroute.cerema.fr/IMG/pdf/iisr_7epartie_vc_20250404.pdf ; IISR 1re partie https://equipementsdelaroute.cerema.fr/IMG/pdf/iisr_1epartie_vc_20250904.pdf

---

## 6. Things I could not verify

1. **Full text of any Légifrance article.** Only search extracts were readable. For several articles the extract confirmed the class but showed the points or suspension only in an older version: R412-10 (suspension), R414-6 (3 points), R415-5 and R415-10 (suspension), R412-9 (suspension), R417-9 (current wording).
2. **R416-1 (horn)** class and amount — from memory.
3. **Sas vélo at a red light**: 135 € / 4 points rests on secondary sources reading R412-30; one source says 35 € / 0 point.
4. **Montreuil**: whether the commune is 100 % zone 30, the date and arrêté, the list of roads kept at 50 km/h, and the list of zones de rencontre.
5. **Paris**: the complete official list of streets kept at 50 km/h; the exact ZTL perimeter exclusions; whether ZTL fines have started after 28 Sept 2026; the tribunal ruling of 13 Oct 2026 on the périphérique (single source); the section of the périphérique excepted from 50 km/h in the arrêté.
6. **Loi RIPOST (Aug 2026)**: exact penalties of the new L237-1 délit and the full list of road measures struck down by the Conseil constitutionnel.
7. **Lozenge signage** still being "experimental" in 2026 (single secondary source).
8. **Inter-file riding**: whether it applies on the périphérique now limited to 50 km/h.
9. **Exam**: which CEPC lines carry the "E" box and the 0.5 scoring step; the official list of eliminatory errors (only three official examples confirmed); the six reverse manoeuvres in the current consolidated arrêté.
10. **REMC** sub-skill wording (from memory, partly matched).
11. **IISR figures not confirmed by an official extract**: pedestrian-crossing band width (50 cm), stop-line width (50 cm), sas depth as written in art. 118-1, octagon sizes, traffic-light mounting heights, repeater height, lens diameters, yellow duration (3 s / 5 s).
12. **CPF funding of the permis B in 2026** and any change to the probationary period (commercial sources only).

To close these gaps, allow `www.legifrance.gouv.fr`, `www.service-public.gouv.fr`, `www.securite-routiere.gouv.fr`, `www.paris.fr`, `cdn.paris.fr`, `www.montreuil.fr`, `equipementsdelaroute.cerema.fr` in the session's network settings and re-run the check on items 1–11.
