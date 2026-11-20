// Questions posées à l'arrêt pendant l'examen pratique : une vérification du véhicule,
// une question de sécurité routière et une question de premiers secours (1 point chacune).

export interface Question { theme: 'verification' | 'securite' | 'secours'; q: string; choices: string[]; answer: number; explain: string }

export const QUESTIONS: Question[] = [
  { theme: 'verification', q: 'Montrez la commande des feux de détresse. Dans quel cas les utilise-t-on ?', choices: ['Pour remercier un autre conducteur', 'Pour signaler un danger : panne, accident, ralentissement brutal', 'Pour stationner en double file'], answer: 1,
    explain: 'Les feux de détresse signalent un danger particulier : véhicule immobilisé, ralentissement important, accident.' },
  { theme: 'verification', q: 'Comment vérifier le niveau d’huile moteur ?', choices: ['Moteur chaud, juste après l’arrêt, en pente', 'Moteur froid ou arrêté depuis plusieurs minutes, sur sol plat, avec la jauge', 'Uniquement au tableau de bord en roulant'], answer: 1,
    explain: 'Sur sol plat, moteur à l’arrêt depuis quelques minutes : le niveau doit se situer entre le mini et le maxi de la jauge.' },
  { theme: 'verification', q: 'Où trouve-t-on les pressions de gonflage préconisées pour les pneus ?', choices: ['Sur le flanc du pneu uniquement', 'Sur une étiquette (portière, trappe à carburant) et dans la notice du véhicule', 'Sur la carte grise'], answer: 1,
    explain: 'Les pressions figurent sur une plaque dans l’encadrement de la portière ou la trappe à carburant, et dans la notice.' },
  { theme: 'verification', q: 'Quelle est la profondeur minimale légale des rainures principales d’un pneu ?', choices: ['0,5 mm', '1,6 mm', '3 mm'], answer: 1,
    explain: '1,6 mm au minimum ; les témoins d’usure dans les rainures permettent de le contrôler.' },
  { theme: 'verification', q: 'Un voyant rouge s’allume au tableau de bord en roulant. Que faites-vous ?', choices: ['Je continue jusqu’à destination', 'Je m’arrête dès que possible en sécurité : il signale une anomalie grave', 'J’attends le prochain contrôle technique'], answer: 1,
    explain: 'Rouge = arrêt immédiat en sécurité (pression d’huile, température, freins…). Orange = anomalie à faire contrôler.' },
  { theme: 'securite', q: 'Quelle distance de sécurité minimale faut-il laisser avec le véhicule qui précède ?', choices: ['La distance parcourue en une seconde', 'La distance parcourue en au moins deux secondes', 'Dix mètres quelle que soit la vitesse'], answer: 1,
    explain: 'Article R412-12 : au moins deux secondes d’intervalle. À 50 km/h, cela représente environ 28 mètres.' },
  { theme: 'securite', q: 'En ville, à quelle distance latérale minimale dépasse-t-on un cycliste ?', choices: ['50 centimètres', '1 mètre', '1,50 mètre'], answer: 1,
    explain: '1 mètre en agglomération, 1,50 mètre hors agglomération (article R414-4).' },
  { theme: 'securite', q: 'À une intersection sans aucune signalisation, à qui cédez-vous le passage ?', choices: ['Aux véhicules venant de gauche', 'Aux véhicules venant de droite', 'Au véhicule le plus rapide'], answer: 1,
    explain: 'C’est la priorité à droite (article R415-5), la règle par défaut en l’absence de panneau ou de feu.' },
  { theme: 'securite', q: 'Quel est le taux d’alcool à ne pas atteindre pour un conducteur en permis probatoire ?', choices: ['0,2 g/L de sang', '0,5 g/L de sang', '0,8 g/L de sang'], answer: 0,
    explain: '0,2 g/L pendant la période probatoire : en pratique, zéro verre.' },
  { theme: 'securite', q: 'Pourquoi contrôler l’angle mort avant de changer de voie ?', choices: ['C’est facultatif si les rétroviseurs sont bien réglés', 'Parce qu’un deux-roues peut s’y trouver sans être visible dans les rétroviseurs', 'Pour vérifier que le clignotant fonctionne'], answer: 1,
    explain: 'Les rétroviseurs laissent des zones non visibles sur les côtés : seul un coup d’œil direct permet de s’assurer qu’elles sont libres.' },
  { theme: 'secours', q: 'Vous arrivez les premiers sur un accident. Dans quel ordre agissez-vous ?', choices: ['Secourir, alerter, protéger', 'Protéger, alerter, secourir', 'Alerter, secourir, protéger'], answer: 1,
    explain: 'P.A.S. : protéger pour éviter le sur-accident, alerter les secours, puis secourir.' },
  { theme: 'secours', q: 'Quels numéros permettent d’alerter les secours ?', choices: ['Le 15, le 18 ou le 112', 'Le 17 uniquement', 'Le 3117'], answer: 0,
    explain: 'Le 15 (SAMU), le 18 (pompiers) ou le 112 (numéro d’urgence européen) ; le 114 par SMS pour les personnes sourdes ou malentendantes.' },
  { theme: 'secours', q: 'Une victime est inconsciente mais respire. Que faites-vous ?', choices: ['Je la laisse sur le dos', 'Je la place en position latérale de sécurité et je surveille sa respiration', 'Je lui donne à boire'], answer: 1,
    explain: 'La position latérale de sécurité libère les voies aériennes en attendant les secours.' },
  { theme: 'secours', q: 'Comment arrêter une hémorragie ?', choices: ['En appuyant fortement sur la plaie, si possible avec un tissu propre', 'En faisant boire la victime', 'En surélevant la tête'], answer: 0,
    explain: 'Une compression directe et continue de la plaie, sans relâcher, jusqu’à l’arrivée des secours.' },
  { theme: 'secours', q: 'Sur une route, à quelle distance environ place-t-on le triangle de présignalisation ?', choices: ['5 mètres', '30 mètres au moins, visible à 100 mètres', '300 mètres'], answer: 1,
    explain: 'À 30 mètres au moins en amont, de façon à être visible à 100 mètres ; le gilet se porte avant de sortir du véhicule.' },
];

/** Tire une question de chaque thème. */
export function drawQuiz(seed: number): Question[] {
  const pick = (theme: Question['theme'], k: number) => { const l = QUESTIONS.filter((q) => q.theme === theme); return l[(seed + k * 7) % l.length]; };
  return [pick('verification', 1), pick('securite', 2), pick('secours', 3)];
}
