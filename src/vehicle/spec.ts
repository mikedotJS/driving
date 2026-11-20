// Caractéristiques du véhicule école : citadine essence 100 ch, boîte manuelle 6 rapports
// (gabarit et chiffres proches d'une Clio V / 208, les voitures d'auto-école les plus répandues).

export interface CarSpec {
  name: string;
  mass: number;            // kg, conducteur compris
  yawInertia: number;      // kg·m²
  wheelbase: number;       // m
  cgToFront: number;       // m (centre de gravité → essieu avant)
  cgHeight: number;        // m
  trackFront: number;      // m
  trackRear: number;       // m
  length: number; width: number; height: number;
  frontOverhang: number;
  wheelRadius: number;     // m
  wheelInertia: number;    // kg·m² par roue
  // moteur
  engineInertia: number;   // kg·m² (volant moteur compris)
  idleRpm: number;
  stallRpm: number;
  redlineRpm: number;
  /** couple pleine charge : [tr/min, N·m, ...] */
  torqueCurve: number[];
  /** couple de frottement (frein moteur) : [tr/min, N·m, ...] */
  frictionCurve: number[];
  // transmission
  gears: number[];         // rapports 1..n
  reverse: number;
  finalDrive: number;
  clutchMaxTorque: number; // N·m
  /** course de pédale (1 = enfoncée) où l'embrayage commence / finit de mordre en relâchant */
  clutchBiteStart: number;
  clutchBiteEnd: number;
  drivelineEfficiency: number;
  // freins
  brakeTorqueFront: number; // N·m par roue, pédale à fond
  brakeTorqueRear: number;
  handbrakeTorque: number;  // N·m par roue arrière
  // direction
  maxSteerDeg: number;      // braquage moyen des roues avant, volant en butée
  steeringWheelLockDeg: number; // angle volant butée à butée / 2
  // aérodynamique et roulement
  cdA: number;
  rollingResistance: number;
  // pneus
  tyreMu: number;           // adhérence de pointe sur sec
  tyreLoadSens: number;     // perte relative d'adhérence quand la charge double
  slipAnglePeakDeg: number;
  slipRatioPeak: number;
  relaxLat: number;         // longueurs de relaxation (m)
  relaxLong: number;
  pneumaticTrail: number;   // m
  casterTrail: number;      // m
  // caisse
  rollStiffnessFrontShare: number;
  rollGradDegPerG: number;  // prise de roulis
  pitchGradDegPerG: number;
  bodyFreqHz: number;
  bodyDamping: number;
  // assistance de direction
  steeringRatio: number;
}

export const CITADINE: CarSpec = {
  name: 'Citadine 1.0 turbo 100 ch',
  mass: 1255,
  yawInertia: 1780,
  wheelbase: 2.583,
  cgToFront: 1.02,
  cgHeight: 0.54,
  trackFront: 1.505,
  trackRear: 1.495,
  length: 4.05, width: 1.80, height: 1.44,
  frontOverhang: 0.83,
  wheelRadius: 0.308,
  wheelInertia: 0.95,
  engineInertia: 0.15,
  idleRpm: 850,
  stallRpm: 380,
  redlineRpm: 6400,
  torqueCurve: [0, 30, 500, 70, 800, 96, 1000, 112, 1500, 146, 2000, 160, 3500, 160, 4500, 152, 5000, 141, 5500, 124, 6000, 104, 6500, 80, 7000, 40],
  frictionCurve: [0, 9, 1000, 15, 2000, 20, 4000, 31, 6000, 44, 7000, 52],
  gears: [3.69, 2.02, 1.30, 0.95, 0.76, 0.63],
  reverse: 3.55,
  finalDrive: 4.2,
  clutchMaxTorque: 270,
  clutchBiteStart: 0.70,
  clutchBiteEnd: 0.36,
  drivelineEfficiency: 0.93,
  brakeTorqueFront: 1450,
  brakeTorqueRear: 720,
  handbrakeTorque: 900,
  maxSteerDeg: 33,
  steeringWheelLockDeg: 450,
  cdA: 0.66,
  rollingResistance: 0.012,
  tyreMu: 1.02,
  tyreLoadSens: 0.16,
  slipAnglePeakDeg: 8,
  slipRatioPeak: 0.11,
  relaxLat: 0.42,
  relaxLong: 0.16,
  pneumaticTrail: 0.034,
  casterTrail: 0.018,
  rollStiffnessFrontShare: 0.58,
  rollGradDegPerG: 4.6,
  pitchGradDegPerG: 2.6,
  bodyFreqHz: 1.45,
  bodyDamping: 0.42,
  steeringRatio: 13.6,
};
