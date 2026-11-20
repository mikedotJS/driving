import { describe, it, expect } from 'vitest';
import { Car, type CarInputs } from '../src/vehicle/car';

const DT = 1 / 100;
const inputs = (o: Partial<CarInputs> = {}): CarInputs => ({ steer: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 0, ...o });

function run(car: Car, seconds: number, fn: (t: number) => CarInputs, each?: (t: number) => void) {
  for (let t = 0; t < seconds; t += DT) { car.update(DT, fn(t)); each?.(t); }
}
function started(mode: Car['mode'] = 'manual'): Car {
  const car = new Car();
  car.mode = mode;
  car.startEngine(inputs({ clutch: 1 }));
  run(car, 1.5, () => inputs({ clutch: 1 }));
  expect(car.engineRunning).toBe(true);
  return car;
}

describe('voiture : moteur et transmission', () => {
  it('démarre et tient le ralenti', () => {
    const car = started();
    run(car, 3, () => inputs());
    expect(car.rpm).toBeGreaterThan(780);
    expect(car.rpm).toBeLessThan(950);
    expect(car.speed).toBeLessThan(0.01);
  });

  it('cale si on relâche brutalement l’embrayage en première sans gaz', () => {
    const car = started();
    car.requestGear(1);
    run(car, 0.3, () => inputs({ clutch: 1 }));
    expect(car.gear).toBe(1);
    let stalled = false;
    car.events.stall = () => { stalled = true; };
    run(car, 2, () => inputs({ clutch: 0 }));
    expect(stalled).toBe(true);
    expect(car.engineRunning).toBe(false);
  });

  it('avance au ralenti si on relâche doucement l’embrayage (point de patinage)', () => {
    const car = started();
    car.requestGear(1);
    run(car, 0.3, () => inputs({ clutch: 1 }));
    let stalled = false;
    car.events.stall = () => { stalled = true; };
    // remonte vite jusqu'au point de patinage, puis traverse la zone de friction en 3 s
    run(car, 3, (t) => inputs({ clutch: Math.max(0.3, 0.72 - (t / 3) * 0.42) }));
    run(car, 4, () => inputs());
    expect(stalled).toBe(false);
    expect(car.speedKmh).toBeGreaterThan(5);
    expect(car.speedKmh).toBeLessThan(10);
  });

  it('refuse de passer un rapport sans débrayer', () => {
    const car = started();
    let grind = 0;
    car.events.grind = () => { grind++; };
    car.requestGear(1);
    run(car, 0.5, () => inputs({ clutch: 0 }));
    expect(car.gear).toBe(0);
    expect(grind).toBeGreaterThan(0);
  });

  it('0 à 100 km/h en 10 à 13 s (boîte pilotée)', () => {
    const car = started('auto');
    car.selector = 'D';
    let t100 = -1, t50 = -1;
    run(car, 25, () => inputs({ throttle: 1 }), (t) => {
      if (t50 < 0 && car.speedKmh >= 50) t50 = t;
      if (t100 < 0 && car.speedKmh >= 100) t100 = t;
    });
    console.log(`0-50 : ${t50.toFixed(1)} s, 0-100 : ${t100.toFixed(1)} s, vitesse à 25 s : ${car.speedKmh.toFixed(0)} km/h, rapport ${car.gear}`);
    expect(t100).toBeGreaterThan(9.5);
    expect(t100).toBeLessThan(13.5);
  });

  it('rampe en boîte automatique, frein relâché', () => {
    const car = started('auto');
    car.selector = 'D';
    run(car, 6, () => inputs());
    expect(car.speedKmh).toBeGreaterThan(3);
    expect(car.speedKmh).toBeLessThan(10);
    run(car, 3, () => inputs({ brake: 0.4 }));
    expect(car.speed).toBeLessThan(0.02);
    expect(car.engineRunning).toBe(true);
  });
});

describe('voiture : freinage et tenue de route', () => {
  it('freine de 50 à 0 km/h en 9 à 13 m avec ABS', () => {
    const car = started('auto');
    car.selector = 'D';
    run(car, 30, () => inputs({ throttle: car.speedKmh < 50 ? 0.6 : 0 }), () => {});
    // stabilise à 50
    while (car.speedKmh > 50) car.update(DT, inputs());
    const x0 = car.z, v0 = car.speedKmh;
    let t = 0;
    while (car.speed > 0.05 && t < 10) { car.update(DT, inputs({ brake: 1 })); t += DT; }
    const dist = Math.abs(car.z - x0);
    console.log(`freinage ${v0.toFixed(0)}→0 : ${dist.toFixed(1)} m en ${t.toFixed(2)} s`);
    expect(dist).toBeGreaterThan(8.5);
    expect(dist).toBeLessThan(13);
    expect(Math.abs(car.x)).toBeLessThan(0.3); // reste en ligne
  });

  it('reste immobile à l’arrêt (pas de dérive numérique)', () => {
    const car = started();
    run(car, 5, () => inputs({ handbrake: 1 }));
    expect(Math.hypot(car.x, car.z)).toBeLessThan(0.005);
    run(car, 5, () => inputs());
    expect(Math.hypot(car.x, car.z)).toBeLessThan(0.02);
    expect(Math.abs(car.heading)).toBeLessThan(1e-3);
  });

  it('rayon de braquage d’environ 10,5 m entre trottoirs à basse vitesse', () => {
    const car = started('auto');
    car.selector = 'D';
    let minX = 0, maxX = 0;
    run(car, 30, () => inputs({ steer: 1, throttle: car.speedKmh < 8 ? 0.25 : 0 }), () => {
      minX = Math.min(minX, car.x); maxX = Math.max(maxX, car.x);
    });
    const diameter = maxX - minX + car.spec.width; // approx. entre trottoirs
    console.log(`diamètre de braquage : ${diameter.toFixed(1)} m`);
    expect(diameter).toBeGreaterThan(9.5);
    expect(diameter).toBeLessThan(12);
  });

  it('atteint ~0,9 g en virage stabilisé et sous-vire à la limite', () => {
    const car = started('auto');
    car.selector = 'D';
    // cercle : braquage fixe, vitesse croissante
    let maxAy = 0;
    run(car, 40, (t) => inputs({ steer: 0.22, throttle: t < 4 ? 0.5 : 0.75 }), () => { maxAy = Math.max(maxAy, Math.abs(car.ay)); });
    console.log(`accélération latérale max : ${(maxAy / 9.81).toFixed(2)} g à ${car.speedKmh.toFixed(0)} km/h, glissement AV ${car.slip[0].toFixed(2)} AR ${car.slip[2].toFixed(2)}`);
    expect(maxAy / 9.81).toBeGreaterThan(0.8);
    expect(maxAy / 9.81).toBeLessThan(1.1);
  });

  it('le volant se recentre : couple de rappel opposé au braquage', () => {
    const car = started('auto');
    car.selector = 'D';
    run(car, 8, () => inputs({ throttle: 0.4 }));
    run(car, 1.5, () => inputs({ throttle: 0.3, steer: 0.1 }));
    expect(car.yawRate).toBeGreaterThan(0); // tourne à droite
    expect(car.steerTorque).toBeLessThan(0); // le volant veut revenir à gauche
    console.log(`couple volant en virage à ${car.speedKmh.toFixed(0)} km/h : ${car.steerTorque.toFixed(2)} N·m, ay=${(car.ay / 9.81).toFixed(2)} g`);
  });
});
