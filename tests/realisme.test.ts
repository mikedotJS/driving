// Fiche de validation : la voiture du jeu comparée aux chiffres publiés d'une citadine réelle de même
// gabarit et de même puissance (Renault Clio V 1.0 TCe 100 : 100 ch, 160 Nm, 1 178 kg à vide,
// 0 à 100 km/h en 11,8 s, 187 km/h — fiches techniques auto-data.net et zeperfs.com).
import { describe, it, expect } from 'vitest';
import { Car, type CarInputs } from '../src/vehicle/car';
import { CITADINE } from '../src/vehicle/spec';

const DT = 1 / 100;
const inputs = (o: Partial<CarInputs> = {}): CarInputs => ({ steer: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 0, ...o });
function auto(): Car {
  const car = new Car();
  car.mode = 'auto';
  car.startEngine(inputs({ brake: 1 }));
  for (let t = 0; t < 1.5; t += DT) car.update(DT, inputs({ brake: 1 }));
  car.selector = 'D';
  return car;
}
const REF = { masseAVide: 1178, couple: 160, puissanceKw: 74, zeroCent: 11.8, vmax: 187, empattement: 2.58, longueur: 4.05 };
const lignes: string[] = [];
const ligne = (nom: string, jeu: string, ref: string) => lignes.push(`| ${nom} | ${jeu} | ${ref} |`);

describe('réalisme : la voiture du jeu face à une citadine réelle de 100 ch', () => {
  it('gabarit, masse et moteur', () => {
    const S = CITADINE;
    let tmax = 0, pmax = 0;
    for (let i = 0; i < S.torqueCurve.length; i += 2) {
      const rpm = S.torqueCurve[i], tq = S.torqueCurve[i + 1];
      tmax = Math.max(tmax, tq);
      pmax = Math.max(pmax, (tq * rpm * Math.PI) / 30 / 1000);
    }
    ligne('Masse en ordre de marche', `${S.mass} kg (conducteur compris)`, `${REF.masseAVide} kg à vide`);
    ligne('Couple maximal', `${tmax} N·m`, `${REF.couple} N·m`);
    ligne('Puissance maximale', `${pmax.toFixed(0)} kW (${(pmax * 1.36).toFixed(0)} ch)`, `${REF.puissanceKw} kW (100 ch)`);
    ligne('Empattement / longueur', `${S.wheelbase.toFixed(2)} m / ${S.length.toFixed(2)} m`, `${REF.empattement} m / ${REF.longueur} m`);
    expect(Math.abs(S.mass - (REF.masseAVide + 75))).toBeLessThan(30);
    expect(tmax).toBe(REF.couple);
    expect(pmax).toBeGreaterThan(70); expect(pmax).toBeLessThan(78);
    expect(Math.abs(S.wheelbase - REF.empattement)).toBeLessThan(0.02);
  });

  it('accélération et vitesse maximale', () => {
    const car = auto();
    let t100 = -1, t = 0;
    for (; t < 110; t += DT) { car.update(DT, inputs({ throttle: 1 })); if (t100 < 0 && car.speedKmh >= 100) t100 = t; }
    const vmax = car.speedKmh;
    ligne('0 à 100 km/h', `${t100.toFixed(1)} s`, `${REF.zeroCent} s`);
    ligne('Vitesse maximale', `${vmax.toFixed(0)} km/h`, `${REF.vmax} km/h`);
    expect(Math.abs(t100 - REF.zeroCent) / REF.zeroCent).toBeLessThan(0.12);
    expect(Math.abs(vmax - REF.vmax)).toBeLessThan(13);
  });

  it('freinage d’urgence : décélération d’environ 1 g sur route sèche', () => {
    const stop = (kmh: number) => {
      const car = auto();
      let t = 0;
      for (; t < 60 && car.speedKmh < kmh; t += DT) car.update(DT, inputs({ throttle: 1 }));
      const x0 = car.x, z0 = car.z, v0 = car.speed;
      for (t = 0; t < 12 && car.speed > 0.05; t += DT) car.update(DT, inputs({ brake: 1 }));
      const d = Math.hypot(car.x - x0, car.z - z0);
      return { d, g: (v0 * v0) / (2 * d) / 9.81 };
    };
    const a = stop(50), b = stop(100);
    ligne('Freinage 50 → 0 km/h', `${a.d.toFixed(1)} m (${a.g.toFixed(2)} g)`, '≈ 10 m (1 g, pneus été sur sec)');
    ligne('Freinage 100 → 0 km/h', `${b.d.toFixed(1)} m (${b.g.toFixed(2)} g)`, '36 à 40 m (essais de la presse pour cette catégorie)');
    expect(a.g).toBeGreaterThan(0.85); expect(a.g).toBeLessThan(1.15);
    expect(b.d).toBeGreaterThan(33); expect(b.d).toBeLessThan(44);
  });

  it('affiche la fiche', () => {
    console.log(['| Grandeur | Jeu | Voiture réelle |', '|---|---|---|', ...lignes].join('\n'));
    expect(lignes.length).toBeGreaterThanOrEqual(8);
  });
});
