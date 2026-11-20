// Catalogue des fautes relevées par le simulateur, avec la règle du Code de la route,
// la sanction encourue dans la réalité et la phrase du moniteur.
//
// État du droit : novembre 2026 (voir docs/code-de-la-route-recherche.md pour les sources).
// Points notables : aucun retrait de point pour un excès inférieur à 5 km/h depuis le 1er janvier
// 2024 (décret n° 2023-1150) ; excès d'au moins 50 km/h constitutif d'un délit depuis le
// 29 décembre 2025 (loi n° 2025-622, décret n° 2025-1269) ; refus de priorité à un piéton : 6 points.

/** Compétences de la grille d'examen (CEPC) auxquelles la faute est rattachée. */
export type Competence =
  | 'installation' | 'commandes' | 'information' | 'allure' | 'reglementation'
  | 'communication' | 'partage' | 'espaces' | 'economie' | 'courtoisie';

export type Severity =
  /** remarque pédagogique, sans conséquence */
  | 'conseil'
  /** erreur de conduite ou infraction */
  | 'faute'
  /** faute grave : éliminatoire à l'examen */
  | 'grave';

export interface Infraction {
  id: string;
  titre: string;
  /** article du Code de la route (vide pour une simple erreur de conduite) */
  article: string;
  /** classe de la contravention (0 = pas une infraction ; 6 = délit) */
  classe: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** amende forfaitaire en euros */
  amende: number;
  points: number;
  severity: Severity;
  competence: Competence;
  /** ce que dit le moniteur (court, sera aussi prononcé) */
  moniteur: string;
  /** rappel de la règle */
  regle: string;
  /** suspension de permis encourue */
  suspension?: boolean;
  /** délai minimal (s) avant de relever à nouveau la même faute */
  cooldown: number;
}

const I = (o: Infraction) => o;

export const INFRACTIONS = {
  // ── Vitesse ──
  vitesse_5: I({
    id: 'vitesse_5', titre: 'Excès de vitesse inférieur à 5 km/h', article: 'R413-14', classe: 4, amende: 135, points: 0,
    severity: 'faute', competence: 'allure', cooldown: 20,
    moniteur: 'Attention à votre vitesse, vous dépassez légèrement la limite.',
    regle: 'La limitation est un maximum, pas un objectif. Depuis le 1er janvier 2024, un excès de moins de 5 km/h ne retire plus de point, mais l’amende reste due : 135 € quand la limite est de 50 km/h ou moins.',
  }),
  vitesse_20: I({
    id: 'vitesse_20', titre: 'Excès de vitesse de 5 à 19 km/h', article: 'R413-14', classe: 4, amende: 135, points: 1,
    severity: 'faute', competence: 'allure', cooldown: 20,
    moniteur: 'Vous roulez trop vite. Ralentissez et respectez la limitation.',
    regle: 'Excès de moins de 20 km/h là où la vitesse est limitée à 50 km/h ou moins : 135 € et 1 point.',
  }),
  vitesse_30: I({
    id: 'vitesse_30', titre: 'Excès de vitesse de 20 à 29 km/h', article: 'R413-14', classe: 4, amende: 135, points: 2,
    severity: 'grave', competence: 'allure', cooldown: 20,
    moniteur: 'Beaucoup trop vite ! Vous êtes à plus de vingt kilomètres-heure au-dessus de la limite.',
    regle: 'Excès de 20 à 29 km/h : 135 € et 2 points.',
  }),
  vitesse_40: I({
    id: 'vitesse_40', titre: 'Excès de vitesse de 30 à 39 km/h', article: 'R413-14', classe: 4, amende: 135, points: 3, suspension: true,
    severity: 'grave', competence: 'allure', cooldown: 20,
    moniteur: 'Excès de vitesse très important. Freinez immédiatement.',
    regle: 'Excès de 30 à 39 km/h : 135 €, 3 points et suspension du permis possible jusqu’à 3 ans.',
  }),
  vitesse_50: I({
    id: 'vitesse_50', titre: 'Excès de vitesse de 40 à 49 km/h', article: 'R413-14', classe: 4, amende: 135, points: 4, suspension: true,
    severity: 'grave', competence: 'allure', cooldown: 20,
    moniteur: 'Excès de vitesse très important. Freinez immédiatement.',
    regle: 'Excès de 40 à 49 km/h : 135 €, 4 points, suspension du permis jusqu’à 3 ans.',
  }),
  vitesse_delit: I({
    id: 'vitesse_delit', titre: 'Grand excès de vitesse (50 km/h et plus)', article: 'L413-1', classe: 6, amende: 300, points: 6, suspension: true,
    severity: 'grave', competence: 'allure', cooldown: 20,
    moniteur: 'Grand excès de vitesse : c’est un délit. Arrêtez-vous.',
    regle: 'Depuis le 29 décembre 2025, dépasser la vitesse autorisée de 50 km/h ou plus est un délit dès la première fois : jusqu’à 3 mois d’emprisonnement et 3 750 € d’amende (amende forfaitaire délictuelle de 300 €), 6 points, suspension et confiscation possibles.',
  }),
  vitesse_inadaptee: I({
    id: 'vitesse_inadaptee', titre: 'Vitesse inadaptée aux circonstances', article: 'R413-17', classe: 4, amende: 135, points: 0,
    severity: 'faute', competence: 'allure', cooldown: 25,
    moniteur: 'Votre allure n’est pas adaptée à la situation, même si vous êtes sous la limite.',
    regle: 'Le conducteur doit rester maître de sa vitesse et la réduire à l’approche des piétons, des cyclistes, des intersections où la visibilité est réduite, dans les rues étroites ou encombrées.',
  }),
  trop_lent: I({
    id: 'trop_lent', titre: 'Allure anormalement réduite', article: 'R413-19', classe: 2, amende: 35, points: 0,
    severity: 'conseil', competence: 'allure', cooldown: 60,
    moniteur: 'Vous pouvez avancer : rien ne justifie de rouler aussi lentement ici.',
    regle: 'Aucun conducteur ne doit gêner la marche normale des autres véhicules en circulant sans raison valable à une vitesse anormalement réduite.',
  }),

  // ── Signalisation, priorités ──
  feu_rouge: I({
    id: 'feu_rouge', titre: 'Feu rouge non respecté', article: 'R412-30', classe: 4, amende: 135, points: 4, suspension: true,
    severity: 'grave', competence: 'reglementation', cooldown: 8,
    moniteur: 'Vous venez de griller un feu rouge !',
    regle: 'Au feu rouge, arrêt absolu avant la ligne d’effet des feux ; à défaut, avant le passage piéton ou à l’aplomb du feu. 135 €, 4 points, suspension possible.',
  }),
  feu_orange: I({
    id: 'feu_orange', titre: 'Feu orange non respecté', article: 'R412-31', classe: 2, amende: 35, points: 0,
    severity: 'faute', competence: 'reglementation', cooldown: 8,
    moniteur: 'À l’orange, on s’arrête. Vous aviez la distance pour le faire.',
    regle: 'Le feu jaune fixe impose l’arrêt, sauf si le conducteur ne peut plus s’arrêter dans des conditions de sécurité suffisantes. 35 €, sans retrait de point.',
  }),
  stop: I({
    id: 'stop', titre: 'Stop non marqué', article: 'R415-6', classe: 4, amende: 135, points: 4, suspension: true,
    severity: 'grave', competence: 'reglementation', cooldown: 8,
    moniteur: 'Vous n’avez pas marqué l’arrêt au stop.',
    regle: 'Au stop, les roues s’arrêtent complètement à la limite de la chaussée abordée, puis on cède le passage à gauche comme à droite. 135 €, 4 points.',
  }),
  cedez: I({
    id: 'cedez', titre: 'Cédez-le-passage non respecté', article: 'R415-7', classe: 4, amende: 135, points: 4, suspension: true,
    severity: 'grave', competence: 'partage', cooldown: 8,
    moniteur: 'Refus de priorité : vous deviez céder le passage.',
    regle: 'Au cédez-le-passage, on ralentit, on observe et on ne s’engage que si l’on ne gêne personne. 135 €, 4 points.',
  }),
  priorite_droite: I({
    id: 'priorite_droite', titre: 'Refus de priorité à droite', article: 'R415-5', classe: 4, amende: 135, points: 4, suspension: true,
    severity: 'grave', competence: 'partage', cooldown: 8,
    moniteur: 'Refus de priorité à droite ! Sans signalisation, on cède à droite.',
    regle: 'À une intersection sans signalisation, chaque conducteur doit céder le passage aux véhicules venant de sa droite. 135 €, 4 points.',
  }),
  giratoire: I({
    id: 'giratoire', titre: 'Refus de priorité dans un giratoire', article: 'R415-10', classe: 4, amende: 135, points: 4, suspension: true,
    severity: 'grave', competence: 'partage', cooldown: 8,
    moniteur: 'À l’entrée du giratoire, la priorité est à ceux qui sont déjà sur l’anneau.',
    regle: 'Dans un carrefour à sens giratoire, on cède le passage aux usagers qui circulent sur la chaussée qui ceinture le carrefour. 135 €, 4 points.',
  }),
  priorite_feu: I({
    id: 'priorite_feu', titre: 'Refus de priorité en tournant', article: 'R415-4', classe: 4, amende: 135, points: 4, suspension: true,
    severity: 'grave', competence: 'partage', cooldown: 8,
    moniteur: 'En tournant à gauche, vous devez laisser passer les véhicules qui viennent en face.',
    regle: 'Le conducteur qui tourne à gauche cède le passage aux véhicules venant en sens inverse sur la chaussée qu’il s’apprête à quitter. 135 €, 4 points.',
  }),
  pieton: I({
    id: 'pieton', titre: 'Refus de priorité à un piéton', article: 'R415-11', classe: 4, amende: 135, points: 6, suspension: true,
    severity: 'grave', competence: 'partage', cooldown: 6,
    moniteur: 'Vous n’avez pas laissé passer le piéton ! C’est six points.',
    regle: 'On cède le passage, en s’arrêtant s’il le faut, au piéton engagé sur la chaussée ou qui manifeste clairement l’intention de traverser — et toujours en zone de rencontre et en aire piétonne. 135 € et 6 points.',
  }),
  carrefour_encombre: I({
    id: 'carrefour_encombre', titre: 'Engagement dans un carrefour encombré', article: 'R415-2', classe: 4, amende: 135, points: 0,
    severity: 'faute', competence: 'information', cooldown: 20,
    moniteur: 'On ne s’engage pas dans un carrefour si l’on risque d’y rester bloqué.',
    regle: 'Même au feu vert, on ne s’engage dans une intersection que si le véhicule ne risque pas d’y être immobilisé et de gêner les autres usagers.',
  }),

  // ── Sens de circulation, voies ──
  sens_interdit: I({
    id: 'sens_interdit', titre: 'Circulation en sens interdit', article: 'R412-28', classe: 4, amende: 135, points: 4, suspension: true,
    severity: 'grave', competence: 'reglementation', cooldown: 10,
    moniteur: 'Sens interdit ! Vous roulez à contresens.',
    regle: 'Le panneau « sens interdit » interdit d’entrer dans la rue, même sur quelques mètres. 135 €, 4 points.',
  }),
  circulation_gauche: I({
    id: 'circulation_gauche', titre: 'Circulation à gauche', article: 'R412-9', classe: 4, amende: 135, points: 3,
    severity: 'grave', competence: 'partage', cooldown: 12,
    moniteur: 'Revenez à droite : vous circulez sur la voie de gauche, à contresens.',
    regle: 'En marche normale, on circule près du bord droit de la chaussée, autant que le permet son état. 135 €, 3 points.',
  }),
  ligne_continue: I({
    id: 'ligne_continue', titre: 'Franchissement d’une ligne continue', article: 'R412-19', classe: 4, amende: 135, points: 3, suspension: true,
    severity: 'grave', competence: 'reglementation', cooldown: 10,
    moniteur: 'Vous avez franchi une ligne continue.',
    regle: 'Une ligne continue ne se franchit pas et ne se chevauche pas (sauf pour dépasser un cycliste si la visibilité le permet). Franchissement : 135 €, 3 points ; chevauchement : 1 point.',
  }),
  voie_bus: I({
    id: 'voie_bus', titre: 'Circulation dans un couloir de bus', article: 'R412-7', classe: 4, amende: 135, points: 0,
    severity: 'faute', competence: 'reglementation', cooldown: 15,
    moniteur: 'Vous êtes dans le couloir de bus, sortez-en.',
    regle: 'Les voies réservées aux bus, les pistes et bandes cyclables et les trottoirs sont interdits aux voitures : on n’y roule pas et on ne s’y arrête pas. 135 €.',
  }),
  bande_cyclable: I({
    id: 'bande_cyclable', titre: 'Circulation sur une bande cyclable', article: 'R412-7', classe: 4, amende: 135, points: 0,
    severity: 'faute', competence: 'partage', cooldown: 15,
    moniteur: 'Ne roulez pas sur la bande cyclable.',
    regle: 'Les bandes et pistes cyclables sont réservées aux cycles et aux engins de déplacement personnel. 135 €.',
  }),
  trottoir: I({
    id: 'trottoir', titre: 'Circulation sur le trottoir', article: 'R412-7', classe: 4, amende: 135, points: 0,
    severity: 'grave', competence: 'commandes', cooldown: 6,
    moniteur: 'Vous êtes monté sur le trottoir !',
    regle: 'Le trottoir est réservé aux piétons. Y monter avec la voiture est une faute éliminatoire à l’examen et une contravention de 135 €.',
  }),
  bordure: I({
    id: 'bordure', titre: 'Bordure de trottoir heurtée', article: '', classe: 0, amende: 0, points: 0,
    severity: 'faute', competence: 'commandes', cooldown: 6,
    moniteur: 'Attention, vous avez touché la bordure.',
    regle: 'Gardez environ 50 cm entre vos roues et le trottoir, et regardez loin devant pour bien placer la voiture.',
  }),

  // ── Communication, contrôles ──
  clignotant: I({
    id: 'clignotant', titre: 'Changement de direction sans clignotant', article: 'R412-10', classe: 2, amende: 35, points: 3, suspension: true,
    severity: 'faute', competence: 'communication', cooldown: 6,
    moniteur: 'Vous avez oublié le clignotant.',
    regle: 'Tout conducteur qui va changer de direction ou de voie doit avertir à l’avance les autres usagers : rétroviseurs, angle mort, clignotant, puis manœuvre. 35 € et 3 points.',
  }),
  clignotant_oublie: I({
    id: 'clignotant_oublie', titre: 'Clignotant resté allumé', article: '', classe: 0, amende: 0, points: 0,
    severity: 'conseil', competence: 'communication', cooldown: 30,
    moniteur: 'Votre clignotant est resté allumé.',
    regle: 'Un clignotant oublié trompe les autres usagers sur vos intentions : éteignez-le après la manœuvre.',
  }),
  controle: I({
    id: 'controle', titre: 'Contrôle visuel oublié', article: '', classe: 0, amende: 0, points: 0,
    severity: 'conseil', competence: 'information', cooldown: 25,
    moniteur: 'Pensez à contrôler votre angle mort avant de vous déporter.',
    regle: 'Avant chaque changement de direction ou de voie : rétroviseur intérieur, rétroviseur extérieur, puis coup d’œil dans l’angle mort.',
  }),
  klaxon: I({
    id: 'klaxon', titre: 'Usage abusif de l’avertisseur sonore', article: 'R416-1', classe: 2, amende: 35, points: 0,
    severity: 'conseil', competence: 'courtoisie', cooldown: 20,
    moniteur: 'En ville, le klaxon ne sert qu’en cas de danger immédiat.',
    regle: 'En agglomération, l’usage de l’avertisseur sonore n’est autorisé qu’en cas de danger immédiat. 35 €.',
  }),

  // ── Espaces de sécurité ──
  distance: I({
    id: 'distance', titre: 'Distance de sécurité insuffisante', article: 'R412-12', classe: 4, amende: 135, points: 3, suspension: true,
    severity: 'faute', competence: 'espaces', cooldown: 20,
    moniteur: 'Vous suivez de trop près. Gardez deux secondes de distance.',
    regle: 'La distance de sécurité correspond à la distance parcourue en au moins deux secondes. 135 €, 3 points.',
  }),
  depassement_cycliste: I({
    id: 'depassement_cycliste', titre: 'Dépassement trop près d’un cycliste', article: 'R414-4', classe: 4, amende: 135, points: 3, suspension: true,
    severity: 'grave', competence: 'espaces', cooldown: 10,
    moniteur: 'Vous êtes passé trop près du cycliste : un mètre minimum en ville.',
    regle: 'Pour dépasser un piéton, un cycliste ou une trottinette, on laisse au moins 1 m en agglomération et 1,50 m hors agglomération. Sans la place, on attend derrière. 135 €, 3 points.',
  }),
  arret_passage: I({
    id: 'arret_passage', titre: 'Arrêt sur un passage piéton', article: 'R417-11', classe: 4, amende: 135, points: 0,
    severity: 'faute', competence: 'partage', cooldown: 20,
    moniteur: 'Ne vous arrêtez pas sur le passage piéton.',
    regle: 'L’arrêt et le stationnement sur un passage piéton, un trottoir ou une bande cyclable sont « très gênants » : 135 €.',
  }),

  // ── Installation ──
  ceinture: I({
    id: 'ceinture', titre: 'Ceinture non attachée', article: 'R412-1', classe: 4, amende: 135, points: 3,
    severity: 'faute', competence: 'installation', cooldown: 30,
    moniteur: 'Votre ceinture ! On l’attache avant de démarrer.',
    regle: 'Le port de la ceinture est obligatoire pour le conducteur et tous les passagers. 135 € et 3 points pour le conducteur.',
  }),
  frein_main: I({
    id: 'frein_main', titre: 'Départ frein à main serré', article: '', classe: 0, amende: 0, points: 0,
    severity: 'conseil', competence: 'commandes', cooldown: 30,
    moniteur: 'Vous roulez avec le frein à main serré.',
    regle: 'Desserrez complètement le frein de stationnement avant de partir.',
  }),
  feux: I({
    id: 'feux', titre: 'Circulation sans éclairage', article: 'R416-11', classe: 4, amende: 135, points: 4, suspension: true,
    severity: 'faute', competence: 'installation', cooldown: 40,
    moniteur: 'Allumez vos feux de croisement.',
    regle: 'De nuit ou par visibilité insuffisante, on circule feux de croisement allumés. 135 €, 4 points.',
  }),

  // ── Maîtrise du véhicule (erreurs de conduite, pas des infractions) ──
  calage: I({
    id: 'calage', titre: 'Moteur calé', article: '', classe: 0, amende: 0, points: 0,
    severity: 'conseil', competence: 'commandes', cooldown: 3,
    moniteur: 'Vous avez calé. Débrayez, point mort, et redémarrez calmement.',
    regle: 'Pour démarrer : débrayez à fond, première, cherchez le point de patinage en relevant doucement le pied gauche, maintenez-le une seconde, puis accélérez légèrement en finissant de relâcher.',
  }),
  rapport: I({
    id: 'rapport', titre: 'Rapport passé sans débrayer', article: '', classe: 0, amende: 0, points: 0,
    severity: 'conseil', competence: 'commandes', cooldown: 6,
    moniteur: 'Débrayez à fond avant de passer la vitesse.',
    regle: 'La pédale d’embrayage doit être complètement enfoncée pendant le changement de rapport.',
  }),
  surregime: I({
    id: 'surregime', titre: 'Régime moteur trop élevé', article: '', classe: 0, amende: 0, points: 0,
    severity: 'conseil', competence: 'economie', cooldown: 25,
    moniteur: 'Passez le rapport supérieur, le moteur tourne trop vite.',
    regle: 'Éco-conduite : en ville, on passe le rapport supérieur vers 2 000 à 2 500 tours par minute.',
  }),
  sousregime: I({
    id: 'sousregime', titre: 'Sous-régime', article: '', classe: 0, amende: 0, points: 0,
    severity: 'conseil', competence: 'commandes', cooldown: 25,
    moniteur: 'Rétrogradez, le moteur est en sous-régime.',
    regle: 'Sous 1 100 tours par minute en charge, le moteur broute : rétrogradez.',
  }),
  freinage_brusque: I({
    id: 'freinage_brusque', titre: 'Freinage brusque', article: '', classe: 0, amende: 0, points: 0,
    severity: 'conseil', competence: 'allure', cooldown: 20,
    moniteur: 'Freinage trop brutal : anticipez davantage.',
    regle: 'Regardez loin, relâchez l’accélérateur tôt et freinez progressivement.',
  }),

  // ── Accidents ──
  collision: I({
    id: 'collision', titre: 'Accrochage', article: 'R413-17', classe: 4, amende: 135, points: 0,
    severity: 'grave', competence: 'commandes', cooldown: 4,
    moniteur: 'Accident ! Vous avez heurté un obstacle.',
    regle: 'Le conducteur doit rester constamment maître de son véhicule et de sa vitesse.',
  }),
  collision_vehicule: I({
    id: 'collision_vehicule', titre: 'Collision avec un véhicule', article: 'R413-17', classe: 4, amende: 135, points: 0,
    severity: 'grave', competence: 'espaces', cooldown: 4,
    moniteur: 'Accident ! Vous avez percuté un autre véhicule.',
    regle: 'Distances de sécurité, anticipation et vitesse adaptée évitent la quasi-totalité des collisions en ville.',
  }),
  collision_cycliste: I({
    id: 'collision_cycliste', titre: 'Cycliste renversé', article: 'R414-4', classe: 4, amende: 135, points: 6, suspension: true,
    severity: 'grave', competence: 'partage', cooldown: 4,
    moniteur: 'Vous avez renversé un cycliste. Dans la réalité, ce serait dramatique.',
    regle: 'Le cycliste est un usager vulnérable : on ne le dépasse qu’avec 1 m d’écart en ville, et on vérifie l’angle mort avant de tourner à droite. Blesser un usager par imprudence est un délit.',
  }),
  collision_pieton: I({
    id: 'collision_pieton', titre: 'Piéton renversé', article: 'R415-11', classe: 4, amende: 135, points: 6, suspension: true,
    severity: 'grave', competence: 'partage', cooldown: 4,
    moniteur: 'Vous avez renversé un piéton. Dans la réalité, ce serait dramatique.',
    regle: 'Blesser un usager par imprudence est un délit (blessures routières) depuis la loi du 9 juillet 2025. À 30 km/h, un piéton heurté survit dans 9 cas sur 10 ; à 50 km/h, dans moins de 1 cas sur 2.',
  }),
} as const;

export type InfractionId = keyof typeof INFRACTIONS;

/** Infraction d'excès de vitesse correspondant à un dépassement (km/h) de la vitesse retenue. */
export function speedingInfraction(excess: number): InfractionId {
  if (excess >= 50) return 'vitesse_delit';
  if (excess >= 40) return 'vitesse_50';
  if (excess >= 30) return 'vitesse_40';
  if (excess >= 20) return 'vitesse_30';
  if (excess >= 5) return 'vitesse_20';
  return 'vitesse_5';
}

/** Texte de sanction lisible : « 135 € · 4 points ». */
export function sanctionText(inf: Infraction): string {
  if (!inf.classe) return 'Erreur de conduite (pas une infraction)';
  const parts: string[] = [];
  parts.push(inf.classe === 6 ? `Délit · amende forfaitaire ${inf.amende} €` : `${inf.amende} € d’amende`);
  parts.push(inf.points ? `${inf.points} point${inf.points > 1 ? 's' : ''}` : 'sans retrait de point');
  if (inf.suspension) parts.push('suspension possible');
  return parts.join(' · ');
}

/** Grille d'évaluation de l'épreuve pratique du permis B (31 points, 20 pour réussir). */
export const GRILLE: { bloc: string; items: { id: Competence | 'verifications' | 'analyse' | 'adaptation' | 'autonomie'; label: string; max: number }[] }[] = [
  { bloc: 'Connaître et maîtriser son véhicule', items: [
    { id: 'installation', label: 'Savoir s’installer et assurer la sécurité à bord', max: 2 },
    { id: 'commandes', label: 'Connaître et utiliser les commandes', max: 3 },
    { id: 'verifications', label: 'Effectuer des vérifications du véhicule', max: 3 },
  ] },
  { bloc: 'Appréhender la route', items: [
    { id: 'information', label: 'Prendre l’information', max: 3 },
    { id: 'allure', label: 'Adapter son allure aux circonstances', max: 3 },
    { id: 'reglementation', label: 'Appliquer la réglementation', max: 3 },
  ] },
  { bloc: 'Partager la route avec les autres usagers', items: [
    { id: 'communication', label: 'Communiquer avec les autres usagers', max: 3 },
    { id: 'partage', label: 'Partager la chaussée', max: 3 },
    { id: 'espaces', label: 'Maintenir les espaces de sécurité', max: 3 },
  ] },
  { bloc: 'Autonomie et conscience du risque', items: [
    { id: 'analyse', label: 'Analyse des situations', max: 1 },
    { id: 'adaptation', label: 'Adaptation aux situations', max: 1 },
    { id: 'autonomie', label: 'Conduite autonome', max: 1 },
  ] },
  { bloc: 'Bonus', items: [
    { id: 'courtoisie', label: 'Courtoisie au volant', max: 1 },
    { id: 'economie', label: 'Conduite économique et respectueuse de l’environnement', max: 1 },
  ] },
];
