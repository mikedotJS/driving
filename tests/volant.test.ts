// Chaîne « volant » vérifiée sans matériel : un Logitech G923 émulé (objet Gamepad et périphérique
// WebHID factices). Les trames de retour de force attendues sont celles des pilotes Linux de référence
// (hid-lg4ff.c pour le G29/G923 PlayStation, hid-logitech-hidpp.c pour le G920/G923 Xbox).
import { describe, it, expect, beforeEach } from 'vitest';

// ── faux environnement de navigateur ──
const store = new Map<string, string>();
const g = globalThis as any;
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
g.addEventListener = () => {};
let pads: any[] = [];
let hidDevices: any[] = [];
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    getGamepads: () => pads,
    hid: { addEventListener: () => {}, getDevices: async () => [], requestDevice: async () => hidDevices },
  },
});

import { Controls, AxisCapture } from '../src/input/controls';
import { ForceFeedback } from '../src/input/ffb';

const G923_PS = 'Logitech G923 Racing Wheel for PlayStation and PC (Vendor: 046d Product: c266)';

function fakePad(id = G923_PS, axes = [0, 1, 1, 0, 0, 1], nButtons = 25) {
  return { id, index: 0, connected: true, mapping: '', axes: axes.slice(), buttons: Array.from({ length: nButtons }, () => ({ pressed: false, value: 0 })) };
}
const press = (pad: any, i: number, on = true) => { pad.buttons[i] = { pressed: on, value: on ? 1 : 0 }; };

describe('Logitech G923 émulé : entrées', () => {
  let target: EventTarget, controls: Controls, pad: any;
  beforeEach(() => {
    store.clear();
    pad = fakePad();
    pads = [pad];
    target = new EventTarget();
    controls = new Controls(target as unknown as Window);
  });

  it('le volant est reconnu comme tel, avec sa pédale d’embrayage', () => {
    const st = controls.update(1 / 60);
    expect(st.device).toBe('wheel');
    expect(st.deviceName).toContain('G923');
    expect(st.hasClutchPedal).toBe(true);
    expect(st.steer).toBeCloseTo(0, 5);
    expect(st.throttle).toBe(0); expect(st.brake).toBe(0); expect(st.clutch).toBe(0);
  });

  it('direction 1:1 : un quart de tour du volant (90° sur 900°) donne 20 % du braquage', () => {
    pad.axes[0] = 90 / 450; // l'axe va de -1 à +1 pour ±450°
    expect(controls.update(1 / 60).steer).toBeCloseTo(0.2, 3);
    pad.axes[0] = -1;
    expect(controls.update(1 / 60).steer).toBeCloseTo(-1, 3);
  });

  it('pédales : repos à +1, enfoncée à -1, avec une petite zone morte', () => {
    pad.axes[2] = -1; // accélérateur à fond
    pad.axes[5] = 0;  // frein à mi-course
    pad.axes[1] = 0.98; // embrayage effleuré : ignoré
    const st = controls.update(1 / 60);
    expect(st.throttle).toBeCloseTo(1, 2);
    expect(st.brake).toBeGreaterThan(0.45); expect(st.brake).toBeLessThan(0.55);
    expect(st.clutch).toBe(0);
  });

  it('palettes : une impulsion par appui, maintien signalé tant que la palette est tirée', () => {
    press(pad, 4);
    let st = controls.update(1 / 60);
    expect(st.pressed.has('shiftUp')).toBe(true);
    st = controls.update(1 / 60);
    expect(st.pressed.has('shiftUp')).toBe(false);
    expect(st.held.has('shiftUp')).toBe(true);
    press(pad, 4, false); press(pad, 5);
    st = controls.update(1 / 60);
    expect(st.pressed.has('shiftDown')).toBe(true);
  });

  it('levier en H (Driving Force Shifter) : le rapport engagé suit la position du levier', () => {
    controls.update(1 / 60);
    controls.profile!.hShifter = true;
    press(pad, controls.profile!.buttons.gear3!);
    expect(controls.update(1 / 60).hGear).toBe(3);
    press(pad, controls.profile!.buttons.gear3!, false);
    expect(controls.update(1 / 60).hGear).toBe(0); // point mort
    press(pad, controls.profile!.buttons.gearR!);
    expect(controls.update(1 / 60).hGear).toBe(-1);
  });

  it('calibration : l’assistant retrouve chaque axe, quel que soit l’ordre annoncé par le navigateur', () => {
    // disposition « Xbox » : volant 0, accélérateur 1, frein 2, embrayage 3 — différente du profil par défaut
    pad.axes = [0, 1, 1, 1];
    const cap = new AxisCapture(controls);
    const found: number[] = [];
    const sweep = (axis: number, values: number[]) => {
      cap.begin();
      for (const v of values) { pad.axes[axis] = v; cap.sample(); }
      const r = cap.result(found)!;
      pad.axes[axis] = values[0];
      found.push(r.index);
      return r;
    };
    const steer = sweep(0, [0, -1, 1, 0]);
    expect(steer.index).toBe(0); expect(steer.min).toBe(-1); expect(steer.max).toBe(1);
    const throttle = sweep(1, [1, 0.2, -1, 1]);
    expect(throttle.index).toBe(1); expect(throttle.rest).toBe(1); expect(throttle.min).toBe(-1);
    expect(sweep(2, [1, -1, 1]).index).toBe(2);
    expect(sweep(3, [1, -1, 1]).index).toBe(3);

    // le profil calibré est appliqué puis mémorisé
    const p = controls.profile!;
    p.steer = { index: 0, left: -1, right: 1 };
    p.throttle = { index: 1, rest: 1, full: -1 }; p.brake = { index: 2, rest: 1, full: -1 }; p.clutch = { index: 3, rest: 1, full: -1 };
    p.calibrated = true;
    controls.saveProfile();
    pad.axes = [0.5, -1, 1, 1];
    const st = controls.update(1 / 60);
    expect(st.steer).toBeCloseTo(0.5, 3); expect(st.throttle).toBeCloseTo(1, 2); expect(st.brake).toBe(0);
    const again = new Controls(new EventTarget() as unknown as Window);
    again.update(1 / 60);
    expect(again.profile!.calibrated).toBe(true);
    expect(again.profile!.throttle!.index).toBe(1);
  });
});

// ── retour de force ──
function fakeHid(productId: number, reportId: number) {
  const sent: { id: number; data: number[] }[] = [];
  const listeners: ((e: any) => void)[] = [];
  const dev: any = {
    vendorId: 0x046d, productId, productName: 'G923', opened: false,
    collections: [{ outputReports: [{ reportId, items: [{ reportSize: 8, reportCount: reportId === 0x11 ? 19 : 7 }] }] }],
    open: async () => { dev.opened = true; },
    addEventListener: (_: string, cb: (e: any) => void) => { listeners.push(cb); },
    sendReport: async (id: number, data: Uint8Array) => {
      sent.push({ id, data: Array.from(data) });
      if (id === 0x11) {
        // réponse HID++ : même en-tête ; getFeature(0x8123) → indice 0x0B ; téléchargement d'effet → emplacement 1
        const reply = new Uint8Array(19);
        reply[0] = data[0]; reply[1] = data[1]; reply[2] = data[2];
        if (data[1] === 0x00) reply[3] = 0x0b;
        else if (data[2] === 0x21) reply[3] = 1;
        queueMicrotask(() => { for (const cb of listeners) cb({ reportId: 0x11, data: new DataView(reply.buffer) }); });
      }
    },
  };
  return { dev, sent };
}
const tick = (ms = 12) => new Promise((r) => setTimeout(r, ms));

describe('Logitech G923 émulé : retour de force', () => {
  it('G923 PlayStation (046d:c266) : trames « classiques » identiques à celles du pilote Linux lg4ff', async () => {
    const { dev, sent } = fakeHid(0xc266, 0);
    hidDevices = [dev];
    const ffb = new ForceFeedback();
    expect(await ffb.connect()).toBe(true);
    expect(ffb.protocol).toBe('classic');
    // initialisation : centrage matériel coupé, rotation 900°, aucun effort
    expect(sent[0]).toEqual({ id: 0, data: [0xf5, 0, 0, 0, 0, 0, 0] });
    expect(sent[1]).toEqual({ id: 0, data: [0xf8, 0x81, 0x84, 0x03, 0, 0, 0] }); // 900 = 0x0384
    expect(sent[2]).toEqual({ id: 0, data: [0x13, 0, 0, 0, 0, 0, 0] });

    ffb.settings.enabled = true; ffb.settings.gain = 1; ffb.settings.invert = false;
    await tick();
    ffb.setForce(0.5);
    await tick();
    // effort constant dans l'emplacement 1 : 0x11 0x08 <niveau> 0x80, niveau 0x80 = neutre
    expect(sent[3].data).toEqual([0x11, 0x08, Math.round(0x80 - 0.5 * 127), 0x80, 0, 0, 0]);
    expect(sent[3].data[2]).toBeLessThan(0x80);
    ffb.setForce(-1);
    await tick();
    expect(sent[4].data).toEqual([0x11, 0x08, 0xff, 0x80, 0, 0, 0]);
    ffb.setForce(0);
    await tick();
    expect(sent[5].data).toEqual([0x13, 0, 0, 0, 0, 0, 0]); // effort nul = effet désactivé

    // réglages : gain et inversion
    ffb.settings.gain = 0.5; ffb.settings.invert = true;
    ffb.setForce(1);
    await tick();
    expect(sent[6].data).toEqual([0x11, 0x08, Math.round(0x80 + 0.5 * 127), 0x80, 0, 0, 0]);
    expect(sent[6].data[2]).toBeGreaterThan(0x80); // sens inversé, demi-gain
    // coupure à la pause
    ffb.stop();
    await tick();
    expect(sent[sent.length - 1].data).toEqual([0x13, 0, 0, 0, 0, 0, 0]);
  });

  it('G923 Xbox (046d:c26e) : protocole HID++, fonctionnalité 0x8123, effet constant à démarrage automatique', async () => {
    const { dev, sent } = fakeHid(0xc26e, 0x11);
    hidDevices = [dev];
    const ffb = new ForceFeedback();
    expect(await ffb.connect()).toBe(true);
    expect(ffb.protocol).toBe('hidpp');
    // IRoot.getFeature(0x8123)
    expect(sent[0].id).toBe(0x11);
    expect(sent[0].data.slice(0, 5)).toEqual([0xff, 0x00, 0x01, 0x81, 0x23]);
    // puis, sur la fonctionnalité trouvée (0x0B) : remise à zéro (fonction 1), gains (fonction 8), téléchargement (fonction 2)
    expect(sent[1].data.slice(0, 3)).toEqual([0xff, 0x0b, 0x11]);
    expect(sent[2].data.slice(0, 5)).toEqual([0xff, 0x0b, 0x81, 0xff, 0xff]);
    expect(sent[3].data.slice(0, 5)).toEqual([0xff, 0x0b, 0x21, 0x00, 0x80]);

    ffb.settings.enabled = true; ffb.settings.gain = 1; ffb.settings.invert = false;
    await tick();
    ffb.setForce(0.5);
    await tick();
    const f = sent[4].data;
    // mise à jour de l'effet de l'emplacement 1 : type constant (0x00) + démarrage automatique (0x80), force sur 16 bits signés
    expect(f.slice(0, 5)).toEqual([0xff, 0x0b, 0x21, 1, 0x80]);
    const force = ((f[9] << 8) | f[10]) << 16 >> 16;
    expect(Math.abs(Math.abs(force) - 0.5 * 32767)).toBeLessThanOrEqual(1);
  });

  it('un périphérique Logitech qui n’est pas un volant à retour de force est refusé proprement', async () => {
    const dev: any = { vendorId: 0x046d, productId: 0xc52b, productName: 'Récepteur', opened: false, collections: [], open: async () => { dev.opened = true; }, addEventListener: () => {}, sendReport: async () => { throw new Error('refusé'); } };
    hidDevices = [dev];
    const ffb = new ForceFeedback();
    expect(await ffb.connect()).toBe(false);
    expect(ffb.connected).toBe(false);
  });
});
