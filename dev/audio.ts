// Page de mise au point du son : curseurs pour l'écoute + vérification chiffrée (rendu hors ligne).
import { CarAudio, type CarAudioState, type OneShot, type NearbyKind } from '../src/audio/car-audio';

// crochets lus par tools/shot.cjs et la console (pas d'augmentation globale de Window : fichier autonome)
const hooks = window as unknown as {
  __ready?: boolean;
  __info?: unknown;
  runAudioCheck?: () => Promise<Record<string, unknown>>;
  carAudio?: CarAudio;
};

const KMH = 1 / 3.6;
const SR = 48000;

function baseState(over: Partial<CarAudioState> = {}): CarAudioState {
  return {
    engineOn: true, starter: false, rpm: 850, load: 0, speed: 0, slip: 0, brake: 0, abs: false,
    surface: 'asphalt', indicator: false, clutchSlip: 0, windowOpen: 0, ...over,
  };
}

// ─────────────────────────────────────────────────────────────── analyse ──

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Spectre de puissance (fenêtre de Hann) moyenné sur les canaux, sur les `n` derniers échantillons. */
function powerSpectrum(buf: AudioBuffer, n: number, endSample = buf.length): Float64Array {
  const out = new Float64Array(n / 2);
  const start = endSample - n;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = d[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    fft(re, im);
    for (let k = 0; k < n / 2; k++) out[k] += (re[k] * re[k] + im[k] * im[k]) / buf.numberOfChannels;
  }
  return out;
}

const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12));
const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;

function aWeight(f: number): number {
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return ra * 1.2589;
}

interface Integrity { nan: number; peakDb: number; maxStep: number; }

function integrity(buf: AudioBuffer): Integrity {
  let nan = 0, peak = 0, step = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    let prev = 0;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { nan++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      const s = Math.abs(v - prev);
      if (i > 0 && s > step) step = s;
      prev = v;
    }
  }
  return { nan, peakDb: r1(db(peak)), maxStep: r2(step) };
}

/** Niveau efficace (dBFS) entre deux instants, moyenné en puissance sur les canaux. */
function rmsDb(buf: AudioBuffer, t0: number, t1: number): number {
  const a = Math.max(0, Math.round(t0 * buf.sampleRate)), b = Math.min(buf.length, Math.round(t1 * buf.sampleRate));
  let s = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = a; i < b; i++) s += d[i] * d[i];
  }
  return r1(10 * Math.log10(Math.max(s / (Math.max(1, b - a) * buf.numberOfChannels), 1e-24)));
}

function peakDbBetween(buf: AudioBuffer, t0: number, t1: number): number {
  const a = Math.max(0, Math.round(t0 * buf.sampleRate)), b = Math.min(buf.length, Math.round(t1 * buf.sampleRate));
  let p = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = a; i < b; i++) { const v = Math.abs(d[i]); if (v > p) p = v; }
  }
  return r1(db(p));
}

interface Spectral {
  rmsDb: number; dBA: number; centroidHz: number; centroidStftHz: number; lfPeakHz: number;
  lfPeaks: [number, number][]; squealBand: number; spectrum: Float64Array; n: number;
}

function spectral(buf: AudioBuffer): Spectral {
  const sr = buf.sampleRate;
  let n = 1;
  while (n * 2 <= buf.length - 0.6 * sr) n *= 2;
  const ps = powerSpectrum(buf, n);
  let tot = 0, cw = 0, aw = 0, sq = 0, best = 0, bi = 0;
  for (let k = 1; k < n / 2; k++) {
    const f = (k * sr) / n, p = ps[k];
    tot += p; cw += f * p;
    const A = aWeight(f);
    aw += p * A * A;
    if (f >= 700 && f <= 1600) sq += p;
    if (f >= 10 && f <= 400 && p > best) { best = p; bi = k; }
  }
  // interpolation parabolique du pic
  const la = Math.log(ps[bi - 1] + 1e-30), lb = Math.log(ps[bi] + 1e-30), lc = Math.log(ps[bi + 1] + 1e-30);
  const off = (0.5 * (la - lc)) / (la - 2 * lb + lc || 1);
  const lfPeakHz = ((bi + clampN(off, -0.5, 0.5)) * sr) / n;
  // principaux pics sous 400 Hz (relatifs au plus fort)
  const peaks: [number, number][] = [];
  for (let k = 2; k < (400 * n) / sr; k++) {
    if (ps[k] > ps[k - 1] && ps[k] >= ps[k + 1] && ps[k] > best * 0.02) peaks.push([r1((k * sr) / n), r1(10 * Math.log10(ps[k] / best))]);
  }
  peaks.sort((a, b) => b[1] - a[1]);
  // centroïde « classique » : trames de 2048, pondération en amplitude
  const m = 2048;
  let cs = 0, cn = 0;
  for (let end = buf.length; end - m >= buf.length - n; end -= m * 3) {
    const p2 = powerSpectrum(buf, m, end);
    let a = 0, b = 0;
    for (let k = 1; k < m / 2; k++) { const mag = Math.sqrt(p2[k]); a += ((k * sr) / m) * mag; b += mag; }
    if (b > 0) { cs += a / b; cn++; }
  }
  const t1 = buf.length / sr;
  const rms = rmsDb(buf, t1 - n / sr, t1);
  return {
    rmsDb: rms, dBA: r1(rms + 10 * Math.log10(aw / tot)), centroidHz: Math.round(cw / tot), centroidStftHz: Math.round(cs / Math.max(1, cn)),
    lfPeakHz: r2(lfPeakHz), lfPeaks: peaks.slice(0, 5), squealBand: r2(sq / tot), spectrum: ps, n,
  };
}

function clampN(x: number, a: number, b: number): number { return x < a ? a : x > b ? b : x; }

// ──────────────────────────────────────────────────────────── scénarios ──

interface Scenario { name: string; label: string; state: CarAudioState; engine: boolean; }

const SCENARIOS: Scenario[] = [
  { name: 'idle', label: 'ralenti 850 tr/min, charge 0', state: baseState({ rpm: 850, load: 0 }), engine: true },
  { name: 'rpm2000_load0.5', label: '2000 tr/min, charge 0,5', state: baseState({ rpm: 2000, load: 0.5 }), engine: true },
  { name: 'rpm4000_load1', label: '4000 tr/min, pleine charge', state: baseState({ rpm: 4000, load: 1 }), engine: true },
  { name: 'rpm6000_load1', label: '6000 tr/min, pleine charge', state: baseState({ rpm: 6000, load: 1 }), engine: true },
  { name: 'coast50', label: 'roue libre 50 km/h, 1500 tr/min, charge 0', state: baseState({ rpm: 1500, load: 0, speed: 50 * KMH }), engine: true },
  { name: 'squeal', label: 'crissement (40 km/h, glissement 1,5)', state: baseState({ rpm: 1500, load: 0, speed: 40 * KMH, slip: 1.5, brake: 1 }), engine: false },
];

interface Row {
  name: string; label: string; rmsDb: number; dBA: number; peakDb: number; centroidHz: number; centroidStftHz: number;
  lfPeakHz: number; firingHz: number | null; lfOrder: string | null; lfPeaks: [number, number][]; nan: number; maxStep: number;
  squealBand: number; pass: boolean; fails: string[];
}

async function runAudioCheck(): Promise<Record<string, unknown>> {
  const t0 = performance.now();
  const fails: string[] = [];
  const rows: Row[] = [];
  const spectra: { row: Row; ps: Float64Array; n: number }[] = [];

  for (const sc of SCENARIOS) {
    const buf = await CarAudio.renderOffline(3.5, () => sc.state, { sampleRate: SR });
    const it = integrity(buf);
    const sp = spectral(buf);
    const rf: string[] = [];
    if (it.nan) rf.push('NaN');
    if (!(it.peakDb < -1)) rf.push(`crête ${it.peakDb} dBFS ≥ −1`);
    if (it.maxStep > 0.5) rf.push(`saut ${it.maxStep} > 0,5`);
    let firingHz: number | null = null, lfOrder: string | null = null;
    if (sc.engine) {
      firingHz = (sc.state.rpm / 60) * 1.5;
      for (const [ord, name] of [[1.5, '1,5'], [1, '1'], [2, '2']] as const) {
        const f = (sc.state.rpm / 60) * ord;
        if (Math.abs(sp.lfPeakHz - f) <= 0.06 * f) { lfOrder = name; break; }
      }
      if (!lfOrder) rf.push(`pic grave ${sp.lfPeakHz} Hz ≠ allumage ${r2(firingHz)} Hz`);
    }
    const row: Row = {
      name: sc.name, label: sc.label, rmsDb: sp.rmsDb, dBA: sp.dBA, peakDb: it.peakDb, centroidHz: sp.centroidHz, centroidStftHz: sp.centroidStftHz,
      lfPeakHz: sp.lfPeakHz, firingHz: firingHz === null ? null : r2(firingHz), lfOrder, lfPeaks: sp.lfPeaks, nan: it.nan, maxStep: it.maxStep,
      squealBand: sp.squealBand, pass: rf.length === 0, fails: rf,
    };
    rows.push(row);
    spectra.push({ row, ps: sp.spectrum, n: sp.n });
    for (const f of rf) fails.push(`${sc.name}: ${f}`);
  }
  const by = (n: string): Row => rows.find((r) => r.name === n) as Row;
  const idle = by('idle'), r2k = by('rpm2000_load0.5'), r4k = by('rpm4000_load1'), r6k = by('rpm6000_load1'), sq = by('squeal'), coast = by('coast50');
  if (!(idle.rmsDb >= -30 && idle.rmsDb <= -24)) fails.push(`ralenti ${idle.rmsDb} dBFS hors −30…−24`);
  if (!(r4k.rmsDb >= -18 && r4k.rmsDb <= -12)) fails.push(`4000 pleine charge ${r4k.rmsDb} dBFS hors −18…−12`);
  if (!(idle.rmsDb < r2k.rmsDb && r2k.rmsDb < r4k.rmsDb && r4k.rmsDb < r6k.rmsDb)) fails.push('niveau non croissant avec le régime');
  if (!(idle.centroidHz < r2k.centroidHz && r2k.centroidHz < r4k.centroidHz && r4k.centroidHz < r6k.centroidHz)) fails.push('centroïde non croissant avec le régime');
  if (!(sq.squealBand > 0.35)) fails.push(`crissement : seulement ${sq.squealBand} de la puissance entre 700 et 1600 Hz`);

  // ── balayage régime × charge : paliers de 1,6 s, mesure sur la dernière seconde ──
  const rpms = [850, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 6400];
  const loads = [0, 0.25, 0.5, 0.75, 1];
  const hold = 1.6;
  const sweep: Record<string, number[]> = {};
  for (const load of loads) {
    const buf = await CarAudio.renderOffline(rpms.length * hold, (t) => baseState({ rpm: rpms[Math.min(rpms.length - 1, Math.floor(t / hold))], load }), { sampleRate: SR });
    const it = integrity(buf);
    if (it.nan || !(it.peakDb < -1) || it.maxStep > 0.5) fails.push(`balayage charge ${load}: intégrité ${JSON.stringify(it)}`);
    sweep[`load${load}`] = rpms.map((_, i) => rmsDb(buf, i * hold + 0.6, (i + 1) * hold));
  }
  for (const load of loads) {
    const r = sweep[`load${load}`];
    for (let i = 1; i < r.length; i++) if (!(r[i] > r[i - 1])) fails.push(`balayage : niveau non croissant ${rpms[i - 1]}→${rpms[i]} tr/min à charge ${load} (${r[i - 1]} → ${r[i]})`);
  }
  for (let i = 0; i < rpms.length; i++) {
    for (let j = 1; j < loads.length; j++) {
      const a = sweep[`load${loads[j - 1]}`][i], b = sweep[`load${loads[j]}`][i];
      if (!(b > a)) fails.push(`balayage : niveau non croissant avec la charge à ${rpms[i]} tr/min (${a} → ${b})`);
    }
  }

  // ── démarrage, sous-régime, calage ──
  const seqBuf = await CarAudio.renderOffline(6.5, (t, a) => {
    if (Math.abs(t - 4.0) < 1e-6) a.play('stall');
    if (t < 0.3) return baseState({ engineOn: false, rpm: 0 });
    if (t < 1.2) return baseState({ engineOn: false, starter: true, rpm: 215 });
    if (t < 1.5) return baseState({ rpm: 300 + ((t - 1.2) / 0.3) * 800, load: 0.5 });
    if (t < 3.0) return baseState({ rpm: 850 + 250 * Math.exp(-(t - 1.5) / 0.25), load: 0.05 });
    if (t < 4.0) return baseState({ rpm: 850 - (t - 3.0) * 460, load: 0.6, clutchSlip: 60 });
    return baseState({ engineOn: false, rpm: 0 });
  }, { sampleRate: SR });
  const seqInt = integrity(seqBuf);
  const sequence = {
    ...seqInt,
    silenceBeforeDb: rmsDb(seqBuf, 0.05, 0.28),
    starterDb: rmsDb(seqBuf, 0.5, 1.2),
    idleDb: rmsDb(seqBuf, 2.2, 3.0),
    lugging600to400Db: rmsDb(seqBuf, 3.55, 4.0),
    stallShudderDb: rmsDb(seqBuf, 4.0, 4.45),
    silenceAfterStallDb: rmsDb(seqBuf, 4.75, 4.95),
    keyOnChimeDb: rmsDb(seqBuf, 4.96, 5.6),
    endDb: rmsDb(seqBuf, 6.3, 6.5),
  };
  if (seqInt.nan || !(seqInt.peakDb < -1) || seqInt.maxStep > 0.5) fails.push(`séquence démarrage/calage : intégrité ${JSON.stringify(seqInt)}`);
  if (!(sequence.starterDb > -32)) fails.push('démarreur inaudible');
  if (!(sequence.lugging600to400Db > sequence.idleDb)) fails.push('sous-régime pas plus fort que le ralenti');
  if (!(sequence.silenceAfterStallDb < -55)) fails.push(`pas de silence après le calage (${sequence.silenceAfterStallDb} dBFS)`);
  if (!(sequence.silenceBeforeDb < -80)) fails.push('bruit moteur coupé');
  // modulation à la fréquence d'allumage près du calage (profondeur de l'enveloppe à 3,6–4,0 s)
  const shudder = envelopeDepth(seqBuf, 3.6, 4.0), steady = envelopeDepth(seqBuf, 2.4, 2.9);
  Object.assign(sequence, { envDepthIdle: steady, envDepthNearStall: shudder });
  if (!(shudder > steady * 1.3)) fails.push(`pas de tremblement près du calage (${steady} → ${shudder})`);

  // ── bruitages, un par un sur moteur au ralenti ──
  const shots: OneShot[] = ['gear', 'grind', 'kerb', 'crash', 'horn', 'handbrake-on', 'handbrake-off', 'seatbelt', 'door', 'chime', 'start-refused', 'tick'];
  const gap = 1.3;
  const shotBuf = await CarAudio.renderOffline(shots.length * gap + 0.6, (t, a) => {
    const i = Math.round((t - 0.3) / gap);
    if (i >= 0 && i < shots.length && Math.abs(t - (0.3 + i * gap)) < 1e-6) a.play(shots[i], 1);
    return baseState({ engineOn: false, rpm: 0 });
  }, { sampleRate: SR });
  const shotInt = integrity(shotBuf);
  const oneShots: Record<string, { rmsDb: number; peakDb: number }> = {};
  shots.forEach((s, i) => {
    const a = 0.3 + i * gap;
    oneShots[s] = { rmsDb: rmsDb(shotBuf, a, a + 0.5), peakDb: peakDbBetween(shotBuf, a, a + gap - 0.05) };
    if (!(oneShots[s].peakDb > -45)) fails.push(`bruitage ${s} inaudible (${oneShots[s].peakDb} dBFS)`);
  });
  if (shotInt.nan || !(shotInt.peakDb < -1) || shotInt.maxStep > 0.5) fails.push(`bruitages : intégrité ${JSON.stringify(shotInt)}`);

  // ── clignotant : cadence mesurée sur 6 s ──
  const indBuf = await CarAudio.renderOffline(6.7, (t) => baseState({ engineOn: false, rpm: 0, indicator: t >= 0.5 }), { sampleRate: SR });
  const onsets = detectOnsets(indBuf, 0.1);
  const indicator = {
    clicks: onsets.length,
    cyclesPerMin: onsets.length > 2 ? r1((60 * (onsets.length - 1)) / 2 / (onsets[onsets.length - 1] - onsets[0])) : 0,
    peakDb: integrity(indBuf).peakDb,
    tickCentroidHz: onsets.length > 1 ? burstCentroid(indBuf, onsets[0]) : 0,
    tockCentroidHz: onsets.length > 1 ? burstCentroid(indBuf, onsets[1]) : 0,
  };
  if (Math.abs(indicator.cyclesPerMin - 90) > 3) fails.push(`clignotant ${indicator.cyclesPerMin} cycles/min ≠ 90`);
  if (!(indicator.tickCentroidHz > indicator.tockCentroidHz * 1.15)) fails.push('tic et tac de même hauteur');

  // ── roulement, pavés, ABS, vent, trafic, ambiance, duck ──
  const lvl = async (seconds: number, fn: (t: number, a: CarAudio) => CarAudioState): Promise<{ rmsDb: number; peakDb: number; nan: number; maxStep: number }> => {
    const b = await CarAudio.renderOffline(seconds, fn, { sampleRate: SR });
    const it = integrity(b);
    if (it.nan || !(it.peakDb < -1) || it.maxStep > 0.5) fails.push(`intégrité ${JSON.stringify(it)}`);
    return { rmsDb: rmsDb(b, 1, seconds), ...it };
  };
  const off = { engineOn: false, rpm: 0 };
  const misc: Record<string, unknown> = {
    road30: await lvl(3, () => baseState({ ...off, speed: 30 * KMH })),
    road50: await lvl(3, () => baseState({ ...off, speed: 50 * KMH })),
    road90: await lvl(3, () => baseState({ ...off, speed: 90 * KMH })),
    road130: await lvl(3, () => baseState({ ...off, speed: 130 * KMH })),
    road130_windowOpen: await lvl(3, () => baseState({ ...off, speed: 130 * KMH, windowOpen: 1 })),
    sett30: await lvl(3, () => baseState({ ...off, speed: 30 * KMH, surface: 'sett' })),
    sett50: await lvl(3, () => baseState({ ...off, speed: 50 * KMH, surface: 'sett' })),
    abs: await lvl(3, () => baseState({ ...off, speed: 30 * KMH, abs: true, brake: 1 })),
    slip0_9: await lvl(3, () => baseState({ ...off, speed: 40 * KMH, slip: 0.9 })),
    slip1_0: await lvl(3, () => baseState({ ...off, speed: 40 * KMH, slip: 1.0 })),
    slip1_5: await lvl(3, () => baseState({ ...off, speed: 40 * KMH, slip: 1.5 })),
    ambience1: await lvl(4, (t, a) => { if (t === 0) a.setAmbience(1); return baseState(off); }),
    ambience1_windowOpen: await lvl(4, (t, a) => { if (t === 0) a.setAmbience(1); return baseState({ ...off, windowOpen: 1 }); }),
    idle_ducked: await lvl(3, (t, a) => { if (t === 0) a.duck(1); return baseState(); }),
    lowRpmNoJudder: await lvl(3, () => baseState({ rpm: 900, load: 0.4 })),
    lowRpmClutchJudder: await lvl(3, () => baseState({ rpm: 900, load: 0.4, clutchSlip: 90 })),
    everything: await lvl(4, (t, a) => {
      if (t === 0) a.setAmbience(1);
      a.setNearbyVehicle(1, 4 + Math.abs(t - 2) * 20, (t - 2) / 2, 14, 'bus');
      a.setNearbyVehicle(2, 6, -0.5, 12, 'moto');
      if (Math.abs(t - 2) < 1e-6) { a.play('crash', 1); a.hornOn(); }
      return baseState({ rpm: 6200, load: 1, speed: 130 * KMH, slip: 1.6, abs: true, surface: 'sett', indicator: true, windowOpen: 1 });
    }),
  };
  const pass = async (kind: NearbyKind): Promise<{ maxDb: number; farDb: number }> => {
    const b = await CarAudio.renderOffline(5, (t, a) => {
      const x = (t - 2.5) * 14;           // le véhicule nous croise à 50 km/h, à 3 m
      a.setNearbyVehicle(7, Math.hypot(x, 3), clampN(x / 12, -1, 1), 14, kind);
      return baseState(off);
    }, { sampleRate: SR });
    const it = integrity(b);
    if (it.nan || !(it.peakDb < -1) || it.maxStep > 0.5) fails.push(`trafic ${kind}: intégrité ${JSON.stringify(it)}`);
    return { maxDb: rmsDb(b, 2.3, 2.7), farDb: rmsDb(b, 0.1, 0.4) };
  };
  // cadences : « tchou-tchou » du démarreur (≈ 5–6 Hz) et claquement de l'ABS (≈ 12 Hz)
  const crankBuf = await CarAudio.renderOffline(4, () => baseState({ ...off, starter: true }), { sampleRate: SR });
  const absBuf = await CarAudio.renderOffline(4, () => baseState({ ...off, abs: true }), { sampleRate: SR });
  const rhythms = {
    starterDb: rmsDb(crankBuf, 1, 4), starterChugHz: modulationHz(crankBuf, 1, 4, 2, 20), starterCentroidHz: spectral(crankBuf).centroidHz,
    absHz: modulationHz(absBuf, 1, 4, 4, 30),
  };
  if (!(rhythms.starterChugHz >= 4.8 && rhythms.starterChugHz <= 6.4)) fails.push(`démarreur : cadence ${rhythms.starterChugHz} Hz hors 5–6 Hz`);
  if (!(rhythms.absHz >= 11 && rhythms.absHz <= 13.5)) fails.push(`ABS : cadence ${rhythms.absHz} Hz ≠ 12 Hz`);
  // sifflement de turbo : raie isolée entre 3 et 9 kHz à 4000 tr/min pleine charge, absente au ralenti
  const turboSp = spectral(await CarAudio.renderOffline(6.5, () => SCENARIOS[2].state, { sampleRate: SR }));   // assez long pour que le turbo soit en régime établi
  const turbo = { at4000: bandPeak(turboSp.spectrum, turboSp.n, 3000, 9500), atIdle: bandPeak(spectra[0].ps, spectra[0].n, 3000, 9500) };
  if (!(turbo.at4000.db > turbo.atIdle.db + 12 && turbo.at4000.db < -44)) fails.push(`turbo : ${JSON.stringify(turbo)}`);
  // autre fréquence d'échantillonnage
  const b441 = await CarAudio.renderOffline(3.5, () => SCENARIOS[1].state, { sampleRate: 44100 });
  const s441 = spectral(b441);
  const sr44100 = { rmsDb: s441.rmsDb, lfPeakHz: s441.lfPeakHz, centroidHz: s441.centroidHz, ...integrity(b441) };
  if (Math.abs(s441.rmsDb - r2k.rmsDb) > 0.6 || Math.abs(s441.lfPeakHz - 50) > 3) fails.push(`44,1 kHz : ${JSON.stringify(sr44100)}`);
  misc.brakeRub = await lvl(3, () => baseState({ ...off, speed: 1.5, brake: 0.6 }));

  // ── trajet type : spectrogramme + recherche de clics (différence seconde hors bruitages impulsionnels) ──
  const drive = await CarAudio.renderOffline(DRIVE_SECONDS, driveScript, { sampleRate: SR });
  const driveInt = integrity(drive);
  if (driveInt.nan || !(driveInt.peakDb < -1) || driveInt.maxStep > 0.5) fails.push(`trajet type : intégrité ${JSON.stringify(driveInt)}`);
  // balayage brutal du régime avec la charge qui bascule 0 ↔ 1 : aucune marche d'escalier ne doit s'entendre
  const zip = await CarAudio.renderOffline(5, (t) => baseState({ rpm: 850 + 5500 * Math.abs(Math.sin(t * 1.9)), load: Math.floor(t * 4) % 2 }), { sampleRate: SR });
  // référence : le même moteur en régime établi au plus fort (fronts raides des impulsions à pleine charge)
  const steadyBuf = await CarAudio.renderOffline(3, () => baseState({ rpm: 6350, load: 1 }), { sampleRate: SR });
  const clicks = { sweepSecondDiff: secondDiff(zip, 0.3, 5), steadySecondDiff: secondDiff(steadyBuf, 0.3, 3), ...integrity(zip) };
  if (!(clicks.sweepSecondDiff < 1.3 * clicks.steadySecondDiff)) fails.push(`clics pendant le balayage (différence seconde ${clicks.sweepSecondDiff} contre ${clicks.steadySecondDiff} en régime établi)`);
  drawSpectrogram(drive);

  misc.passbyCar = await pass('car');
  misc.passbyBus = await pass('bus');
  misc.passbyMoto = await pass('moto');
  const g = misc as Record<string, { rmsDb: number }>;
  if (!(g.road30.rmsDb < g.road50.rmsDb && g.road50.rmsDb < g.road90.rmsDb && g.road90.rmsDb < g.road130.rmsDb)) fails.push('bruit de roulement non croissant avec la vitesse');
  if (!(g.sett30.rmsDb > g.road30.rmsDb + 3)) fails.push('pavés pas plus forts que l\'asphalte');
  if (!(g.slip0_9.rmsDb <= g.slip1_0.rmsDb && g.slip1_0.rmsDb < g.slip1_5.rmsDb)) fails.push('crissement non progressif');
  if (!(g.idle_ducked.rmsDb < idle.rmsDb - 3)) fails.push('duck sans effet');

  const result: Record<string, unknown> = {
    ok: fails.length === 0,
    fails,
    sampleRate: SR,
    scenarios: rows.map(({ label: _label, ...r }) => r),
    sweepRpm: rpms,
    sweepRmsDb: sweep,
    sequence,
    oneShots: { ...shotInt, shots: oneShots },
    indicator,
    rhythms,
    turbo,
    drive: driveInt,
    clicks,
    sr44100,
    misc,
    coastVsIdle: r1(coast.rmsDb - idle.rmsDb),
    ms: Math.round(performance.now() - t0),
  };
  renderReport(result, rows, spectra);
  return result;
}

/** Profondeur de modulation de l'enveloppe (écart-type / moyenne de |x| lissé à ~8 ms). */
function envelopeDepth(buf: AudioBuffer, t0: number, t1: number): number {
  const d = buf.getChannelData(0);
  const a = Math.round(t0 * buf.sampleRate), b = Math.round(t1 * buf.sampleRate);
  const k = 1 - Math.exp(-1 / (0.008 * buf.sampleRate));
  let e = 0, s = 0, s2 = 0, n = 0;
  for (let i = Math.max(0, a - 2000); i < b; i++) {
    e += k * (Math.abs(d[i]) - e);
    if (i >= a) { s += e; s2 += e * e; n++; }
  }
  const mean = s / n;
  return r2(Math.sqrt(Math.max(0, s2 / n - mean * mean)) / (mean || 1));
}

const DRIVE_SECONDS = 14.5;
const lerp = (a: number, b: number, k: number): number => a + (b - a) * clampN(k, 0, 1);

/** Trajet type pour le spectrogramme : démarrage, ralenti, coup de gaz, 1re, 2e, retenue, freinage ABS, calage. */
function driveScript(t: number, a: CarAudio): CarAudioState {
  const at = (x: number): boolean => Math.abs(t - x) < 1e-6;
  if (at(7.5)) a.play('gear');
  if (at(13.0)) a.play('stall');
  if (t < 0.4) return baseState({ engineOn: false, rpm: 0 });
  if (t < 1.2) return baseState({ engineOn: false, starter: true, rpm: 215 });
  if (t < 1.5) return baseState({ rpm: lerp(300, 1100, (t - 1.2) / 0.3), load: 0.5 });
  if (t < 3.0) return baseState({ rpm: 850 + 250 * Math.exp(-(t - 1.5) / 0.25), load: 0.05 });
  if (t < 3.6) return baseState({ rpm: lerp(850, 3000, (t - 3.0) / 0.6), load: 0.9 });
  if (t < 4.4) return baseState({ rpm: lerp(3000, 850, (t - 3.6) / 0.8), load: 0 });
  if (t < 5.4) return baseState({ rpm: 1200, load: 0.5, clutchSlip: lerp(90, 0, (t - 4.4) / 1.0), speed: lerp(0, 3, (t - 4.4) / 1.0) });
  if (t < 7.4) return baseState({ rpm: lerp(1300, 4200, (t - 5.4) / 2), load: 0.85, speed: lerp(3, 10, (t - 5.4) / 2) });
  if (t < 7.7) return baseState({ rpm: lerp(4200, 2300, (t - 7.4) / 0.3), load: 0, speed: 10 });
  if (t < 9.7) return baseState({ rpm: lerp(2300, 4000, (t - 7.7) / 2), load: 0.85, speed: lerp(10, 17, (t - 7.7) / 2) });
  if (t < 10.7) return baseState({ rpm: lerp(4000, 3200, (t - 9.7) / 1), load: 0, speed: lerp(17, 15.5, (t - 9.7) / 1), indicator: true });
  if (t < 12.2) {
    const k = (t - 10.7) / 1.5;
    return baseState({ rpm: lerp(3200, 900, k), load: 0, speed: lerp(15.5, 1.5, k), brake: 1, abs: t > 10.9 && t < 11.9, slip: t > 11 && t < 11.7 ? 1.45 : 0.3, indicator: true });
  }
  if (t < 13.0) return baseState({ rpm: lerp(900, 390, (t - 12.2) / 0.8), load: 0.4, speed: 1, clutchSlip: 40 });
  return baseState({ engineOn: false, rpm: 0 });
}

/** Plus grande différence seconde |x[i] − 2x[i−1] + x[i−2]| : une marche d'escalier ou un clic la fait bondir. */
function secondDiff(buf: AudioBuffer, t0: number, t1: number): number {
  let m = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = Math.max(2, Math.round(t0 * buf.sampleRate)); i < Math.min(d.length, Math.round(t1 * buf.sampleRate)); i++) {
      const v = Math.abs(d[i] - 2 * d[i - 1] + d[i - 2]);
      if (v > m) m = v;
    }
  }
  return Math.round(m * 1e5) / 1e5;
}

function drawSpectrogram(buf: AudioBuffer): void {
  const cv = $<HTMLCanvasElement>('sgram');
  const c = cv.getContext('2d');
  if (!c) return;
  const W = cv.width, H = cv.height, n = 4096, f0 = 20, f1 = 8000;
  const img = c.createImageData(W, H);
  const stops = [[0, 0, 4], [59, 15, 112], [182, 54, 121], [251, 136, 97], [252, 253, 191]];
  const colour = (v: number): [number, number, number] => {          // 0..1 → noir, violet, rose, orange, crème
    const x = clampN(v, 0, 0.9999) * (stops.length - 1), i = Math.floor(x), f = x - i;
    return [0, 1, 2].map((c) => stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f) as [number, number, number];
  };
  for (let x = 0; x < W; x++) {
    const end = Math.min(buf.length, Math.max(n, Math.round(((x + 0.5) / W) * buf.length + n / 2)));
    const ps = powerSpectrum(buf, n, end);
    for (let y = 0; y < H; y++) {
      const fa = f0 * (f1 / f0) ** ((H - y - 1) / H), fb = f0 * (f1 / f0) ** ((H - y) / H);
      const ka = (fa * n) / SR, kb = Math.max(ka + 1e-3, (fb * n) / SR);
      let m = 0;
      if (kb - ka < 1) {
        const k0 = Math.floor((ka + kb) / 2), fr = (ka + kb) / 2 - k0;
        m = ps[k0] * (1 - fr) + ps[k0 + 1] * fr;
      } else for (let k = Math.floor(ka); k < kb; k++) if (ps[k] > m) m = ps[k];
      const dbv = 10 * Math.log10(m / ((n * n) / 16) + 1e-30);
      const [r, g, b] = colour((dbv + 105) / 85);
      const o = (y * W + x) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  c.font = '18px system-ui'; c.fillStyle = '#ffffffb0'; c.strokeStyle = '#ffffff30';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000]) {
    const y = H - (Math.log(f / f0) / Math.log(f1 / f0)) * H;
    c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
    c.fillText(f >= 1000 ? `${f / 1000} k` : String(f), 4, y - 3);
  }
  for (let s = 1; s < buf.duration; s++) {
    const x = (s / buf.duration) * W;
    c.beginPath(); c.moveTo(x, H - 8); c.lineTo(x, H); c.stroke();
    c.fillText(`${s}`, x + 2, H - 4);
  }
}

/** Fréquence dominante de la modulation d'amplitude entre fmin et fmax (Hz). */
function modulationHz(buf: AudioBuffer, t0: number, t1: number, fmin: number, fmax: number): number {
  const sr = buf.sampleRate, d = buf.getChannelData(0);
  const a = Math.round(t0 * sr), b = Math.min(buf.length, Math.round(t1 * sr));
  const dec = Math.round(sr / 400), k = 1 - Math.exp(-1 / (0.004 * sr));
  const env: number[] = [];
  let e = 0, mean = 0;
  for (let i = a; i < b; i++) {
    e += k * (Math.abs(d[i]) - e);
    if ((i - a) % dec === 0) { env.push(e); mean += e; }
  }
  mean /= env.length || 1;
  let best = 0, bf = 0;
  for (let f = fmin; f <= fmax; f += 0.02) {
    let re = 0, im = 0;
    const w = (2 * Math.PI * f * dec) / sr;
    for (let j = 0; j < env.length; j++) {
      const h = (env[j] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * j) / env.length));
      re += h * Math.cos(w * j); im -= h * Math.sin(w * j);
    }
    const m = re * re + im * im;
    if (m > best) { best = m; bf = f; }
  }
  return r2(bf);
}

/** Raie la plus forte d'une bande : fréquence et niveau (dBFS d'une sinusoïde équivalente). */
function bandPeak(ps: Float64Array, n: number, f0: number, f1: number): { hz: number; db: number } {
  let best = 0, bi = 0;
  for (let k = Math.ceil((f0 * n) / SR); k < (f1 * n) / SR; k++) if (ps[k] > best) { best = ps[k]; bi = k; }
  return { hz: Math.round((bi * SR) / n), db: r1(10 * Math.log10(best / ((n * n) / 16) + 1e-30)) };
}

function detectOnsets(buf: AudioBuffer, minGap: number): number[] {
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const thr = peak * 0.3, out: number[] = [];
  let last = -1;
  for (let i = 0; i < d.length; i++) {
    if (Math.abs(d[i]) > thr && (last < 0 || (i - last) / sr > minGap)) { out.push(i / sr); last = i; }
  }
  return out;
}

function burstCentroid(buf: AudioBuffer, t: number): number {
  const n = 512, end = Math.min(buf.length, Math.round(t * buf.sampleRate) + n - 128);
  if (end < n) return 0;
  const ps = powerSpectrum(buf, n, end);
  let a = 0, b = 0;
  for (let k = 1; k < n / 2; k++) { a += ((k * buf.sampleRate) / n) * ps[k]; b += ps[k]; }
  return Math.round(a / (b || 1));
}

// ──────────────────────────────────────────────────────────── affichage ──

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function renderReport(result: Record<string, unknown>, rows: Row[], spectra: { row: Row; ps: Float64Array; n: number }[]): void {
  const fails = result.fails as string[];
  $('status').textContent = `Vérification hors ligne terminée en ${String(result.ms)} ms (OfflineAudioContext ${SR} Hz, chaîne complète avec limiteur).`;
  const v = $('verdict');
  v.textContent = fails.length ? `✗ ${fails.length} écart(s) : ${fails.join(' · ')}` : '✓ tous les contrôles passent';
  v.className = fails.length ? 'ko' : 'ok';
  const head = '<tr><th>scénario</th><th>RMS dBFS</th><th>dB(A)</th><th>crête dBFS</th><th>centroïde Hz</th><th>pic &lt; 400 Hz</th><th>allumage Hz</th><th>ordre</th><th>saut max</th><th></th></tr>';
  $('tbl').innerHTML = head + rows.map((r) => `<tr><td>${r.label}</td><td>${r.rmsDb}</td><td>${r.dBA}</td><td>${r.peakDb}</td><td>${r.centroidHz}</td><td>${r.lfPeakHz}</td><td>${r.firingHz ?? '—'}</td><td>${r.lfOrder ?? '—'}</td><td>${r.maxStep}</td><td class="${r.pass ? 'ok' : 'ko'}">${r.pass ? '✓' : '✗ ' + r.fails.join(', ')}</td></tr>`).join('');

  const sweep = result.sweepRmsDb as Record<string, number[]>;
  const rpms = result.sweepRpm as number[];
  let txt = 'Balayage RMS dBFS   ' + rpms.map((r) => String(r).padStart(6)).join('') + '\n';
  for (const k of Object.keys(sweep)) txt += k.padEnd(20) + sweep[k].map((x) => x.toFixed(1).padStart(6)).join('') + '\n';
  txt += '\nséquence démarrage → calage : ' + JSON.stringify(result.sequence);
  txt += '\nclignotant : ' + JSON.stringify(result.indicator) + ' · cadences : ' + JSON.stringify(result.rhythms) + ' · turbo : ' + JSON.stringify(result.turbo);
  txt += '\nbruitages (crête dBFS) : ' + Object.entries((result.oneShots as { shots: Record<string, { peakDb: number }> }).shots).map(([k, o]) => `${k} ${o.peakDb}`).join(' · ');
  txt += '\ndivers (RMS dBFS) : ' + Object.entries(result.misc as Record<string, { rmsDb?: number; maxDb?: number }>).map(([k, o]) => `${k} ${o.rmsDb ?? o.maxDb}`).join(' · ');
  $('extra').textContent = txt;

  // spectres
  const cv = $<HTMLCanvasElement>('spec');
  const c = cv.getContext('2d');
  if (!c) return;
  const W = cv.width, H = cv.height, f0 = 10, f1 = 5000, dbSpan = 70;
  c.clearRect(0, 0, W, H);
  const X = (f: number): number => (Math.log(f / f0) / Math.log(f1 / f0)) * W;
  c.font = '20px system-ui';
  c.strokeStyle = '#262c35'; c.fillStyle = '#6b7684'; c.lineWidth = 1;
  for (const f of [20, 50, 100, 200, 500, 1000, 2000]) {
    c.beginPath(); c.moveTo(X(f), 0); c.lineTo(X(f), H); c.stroke();
    c.fillText(f >= 1000 ? `${f / 1000} k` : String(f), X(f) + 4, H - 6);
  }
  const colors = ['#8ab4ff', '#6fd08c', '#ffd166', '#ff7a6b', '#c792ea', '#5fd7d7'];
  let top = -Infinity;
  const curves = spectra.map(({ ps, n }) => {
    // lissage en 1/24 d'octave, en dB
    const pts: [number, number][] = [];
    for (let f = f0; f < f1; f *= 2 ** (1 / 48)) {
      const a = Math.max(1, Math.floor((f / 2 ** (1 / 48)) * n / SR)), b = Math.max(a + 1, Math.ceil((f * 2 ** (1 / 48)) * n / SR));
      let m = 0;
      for (let k = a; k < b; k++) if (ps[k] > m) m = ps[k];
      const d = 10 * Math.log10(m / (n * n * 0.0625) + 1e-30);
      if (d > top) top = d;
      pts.push([f, d]);
    }
    return pts;
  });
  curves.forEach((pts, i) => {
    c.strokeStyle = colors[i % colors.length]; c.lineWidth = 2;
    c.beginPath();
    pts.forEach(([f, d], j) => { const y = ((top + 3 - d) / dbSpan) * H; if (j) c.lineTo(X(f), y); else c.moveTo(X(f), y); });
    c.stroke();
    const row = spectra[i].row;
    if (row.firingHz) { c.setLineDash([6, 6]); c.beginPath(); c.moveTo(X(row.firingHz), 0); c.lineTo(X(row.firingHz), H); c.stroke(); c.setLineDash([]); }
    c.fillStyle = colors[i % colors.length];
    c.fillText(row.label, W - 470, 26 + i * 24);
  });
}

// ────────────────────────────────────────────────────── écoute manuelle ──

const audio = new CarAudio();
hooks.carAudio = audio;
const st = baseState({ engineOn: false, rpm: 0 });
const manual = { ambience: 0, volume: 1 };

function slider(label: string, min: number, max: number, step: number, value: number, unit: string, on: (v: number) => void): HTMLInputElement {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('span');
  l.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'range'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(value);
  const out = document.createElement('output');
  const show = (): void => { out.textContent = `${inp.value}${unit}`; };
  inp.addEventListener('input', () => { on(Number(inp.value)); show(); });
  show();
  row.append(l, inp, out);
  $('sliders').append(row);
  return inp;
}

function button(parent: string, label: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => { void audio.init().then(fn); });
  $(parent).append(b);
  return b;
}

function checkbox(label: string, get: () => boolean, set: (v: boolean) => void): HTMLInputElement {
  const l = document.createElement('label');
  l.className = 'chk';
  const c = document.createElement('input');
  c.type = 'checkbox'; c.checked = get();
  c.addEventListener('change', () => set(c.checked));
  l.append(c, label);
  $('checks').append(l);
  return c;
}

const sRpm = slider('régime', 0, 7000, 10, 0, ' tr/min', (v) => { st.rpm = v; });
const sLoad = slider('charge', 0, 1, 0.01, 0, '', (v) => { st.load = v; });
slider('vitesse', 0, 150, 1, 0, ' km/h', (v) => { st.speed = v * KMH; });
slider('glissement', 0, 3, 0.01, 0, '', (v) => { st.slip = v; });
slider('frein', 0, 1, 0.01, 0, '', (v) => { st.brake = v; });
slider('embrayage', 0, 200, 1, 0, ' rad/s', (v) => { st.clutchSlip = v; });
slider('vitre', 0, 1, 0.01, 0, '', (v) => { st.windowOpen = v; });
slider('ambiance', 0, 1, 0.01, 0, '', (v) => { manual.ambience = v; audio.setAmbience(v); });
slider('volume', 0, 1, 0.01, 1, '', (v) => { manual.volume = v; audio.setMasterVolume(v); });
const cOn = checkbox('moteur', () => st.engineOn, (v) => { st.engineOn = v; });
const cStarter = checkbox('démarreur', () => st.starter, (v) => { st.starter = v; });
checkbox('ABS', () => st.abs, (v) => { st.abs = v; });
checkbox('clignotant', () => st.indicator, (v) => { st.indicator = v; });
checkbox('pavés', () => st.surface === 'sett', (v) => { st.surface = v ? 'sett' : 'asphalt'; });
checkbox('moniteur parle (duck)', () => false, (v) => audio.duck(v ? 1 : 0));

// séquences pilotées (elles prennent la main sur régime / charge)
let seq: ((t: number) => boolean) | null = null;
let seqT0 = 0;
function runSeq(fn: (t: number) => boolean): void { seq = fn; seqT0 = performance.now() / 1000; }
function syncUi(): void {
  sRpm.value = String(Math.round(st.rpm)); sRpm.dispatchEvent(new Event('input'));
  sLoad.value = String(st.load); sLoad.dispatchEvent(new Event('input'));
  cOn.checked = st.engineOn; cStarter.checked = st.starter;
}
button('seqs', 'Démarrer', () => runSeq((t) => {
  if (t < 0.9) { st.engineOn = false; st.starter = true; st.rpm = 215; st.load = 0; return true; }
  st.starter = false; st.engineOn = true;
  if (t < 1.2) { st.rpm = 300 + ((t - 0.9) / 0.3) * 800; st.load = 0.5; return true; }
  st.rpm = 850 + 250 * Math.exp(-(t - 1.2) / 0.25); st.load = 0.05;
  return t < 2.5;
}));
button('seqs', 'Caler', () => runSeq((t) => {
  if (t < 1.0) { st.engineOn = true; st.rpm = 850 - t * 460; st.load = 0.6; st.clutchSlip = 60; return true; }
  st.engineOn = false; st.rpm = 0; st.load = 0; st.clutchSlip = 0;
  audio.play('stall');
  return false;
}));
button('seqs', 'Couper le contact', () => { st.engineOn = false; st.starter = false; st.rpm = 0; st.load = 0; syncUi(); });
let shiftedLeg = 0;
button('seqs', 'Accélération 1→3 (passages de rapport)', () => runSeq((t) => {
  st.engineOn = true;
  const legs: [number, number, number][] = [[0, 1000, 4200], [2.2, 2300, 4200], [4.6, 2700, 3800]];
  let leg = legs[0];
  for (const l of legs) if (t >= l[0]) leg = l;
  const k = Math.min(1, (t - leg[0]) / 2.0);
  const shifting = t - leg[0] < 0.25 && leg[0] > 0;
  if (leg[0] !== shiftedLeg) { shiftedLeg = leg[0]; if (leg[0] > 0) audio.play('gear'); }
  st.rpm = leg[1] + (leg[2] - leg[1]) * k; st.load = shifting ? 0 : 0.85;
  st.speed = Math.min(22, t * 3.2);
  if (t > 6.8) { st.load = 0; st.rpm = 1500; }
  return t < 7;
}));
button('seqs', 'Montée en régime au point mort', () => runSeq((t) => {
  st.engineOn = true;
  const up = t < 2.5;
  st.rpm = up ? 850 + (t / 2.5) * 5550 : Math.max(850, 6400 - (t - 2.5) * 3200);
  st.load = up ? 0.9 : 0;
  return t < 4.5;
}));

const SHOTS: OneShot[] = ['gear', 'grind', 'kerb', 'crash', 'horn', 'handbrake-on', 'handbrake-off', 'seatbelt', 'door', 'chime', 'start-refused', 'tick', 'stall'];
for (const s of SHOTS) button('shots', s, () => audio.play(s));
const horn = button('shots', 'klaxon (maintenir)', () => undefined);
horn.addEventListener('pointerdown', () => { void audio.init().then(() => audio.hornOn()); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) horn.addEventListener(ev, () => audio.hornOff());

interface Passer { id: number; kind: NearbyKind; t0: number; speed: number; side: number; }
const passers: Passer[] = [];
let nextId = 1;
for (const kind of ['car', 'bus', 'moto'] as NearbyKind[]) {
  button('traffic', `croisement ${kind}`, () => { passers.push({ id: nextId++, kind, t0: performance.now() / 1000, speed: kind === 'bus' ? 10 : 14, side: Math.random() < 0.5 ? -1 : 1 }); });
}

$('start').addEventListener('click', () => { void audio.init(); });
let muted = false;
$('mute').addEventListener('click', () => { muted = !muted; audio.setMuted(muted); $('mute').textContent = muted ? 'Rétablir le son' : 'Muet'; });

let lastT = performance.now() / 1000;
function frame(): void {
  const now = performance.now() / 1000;
  const dt = Math.min(0.1, now - lastT);
  lastT = now;
  if (seq) {
    if (!seq(now - seqT0)) seq = null;
    syncUi();
  }
  if (audio.ready) {
    for (let i = passers.length - 1; i >= 0; i--) {
      const p = passers[i];
      const x = (now - p.t0 - 4) * p.speed;
      if (x > 60) { passers.splice(i, 1); continue; }
      audio.setNearbyVehicle(p.id, Math.hypot(x, 3), clampN((x / 12) * p.side, -1, 1), p.speed, p.kind);
    }
    audio.update(st, dt);
  }
  $('live').textContent = audio.ready ? `contexte ${audio.context?.state ?? ''} · ${audio.context?.sampleRate ?? ''} Hz` : 'son inactif (cliquer)';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ───────────────────────────────────────────── vérification automatique ──

hooks.runAudioCheck = runAudioCheck;
runAudioCheck()
  .then((res) => { hooks.__info = res; })
  .catch((e: unknown) => {
    console.error(e);
    hooks.__info = { ok: false, error: String(e) };
    $('status').textContent = `Échec de la vérification : ${String(e)}`;
    $('status').className = 'ko';
  })
  .finally(() => { hooks.__ready = true; });
