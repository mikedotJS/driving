// Voix du moniteur : fichiers audio pré-enregistrés quand ils existent (public/audio/voix/<clé>.mp3),
// sinon synthèse vocale du navigateur en français.

export class Voice {
  enabled = true;
  volume = 1;
  private manifest = new Set<string>();
  private cache = new Map<string, AudioBuffer>();
  private ctx: AudioContext | null = null;
  private bus: AudioNode | null = null;
  private current: AudioBufferSourceNode | null = null;
  private queue: { key: string | null; text: string }[] = [];
  private speaking = false;
  private frVoice: SpeechSynthesisVoice | null = null;
  onSpeak?: (active: boolean) => void;
  last = '';

  /** liste des répliques enregistrées, chargée dès l'ouverture de la page (sans attendre le son) */
  private manifestReady: Promise<void> = this.loadManifest();

  private async loadManifest() {
    try {
      const r = await fetch('audio/voix/manifest.json');
      if (r.ok) for (const k of (await r.json()) as string[]) this.manifest.add(k);
    } catch { /* pas de voix enregistrées */ }
  }

  async init(ctx: AudioContext | null, bus: AudioNode | null) {
    this.ctx = ctx; this.bus = bus;
    await this.manifestReady;
    const pick = () => {
      const voices = speechSynthesis?.getVoices?.() ?? [];
      this.frVoice = voices.find((v) => /fr[-_]FR/i.test(v.lang) && /natural|google|premium|enhanced|thomas|amélie|amelie/i.test(v.name)) ?? voices.find((v) => /^fr/i.test(v.lang)) ?? null;
    };
    if ('speechSynthesis' in window) { pick(); speechSynthesis.onvoiceschanged = pick; }
  }

  /** Dit une phrase ; `key` désigne un enregistrement éventuel. `urgent` coupe la phrase en cours. */
  say(text: string, key: string | null = null, urgent = false) {
    if (!text) return;
    this.last = text;
    if (!this.enabled) return;
    if (urgent) { this.queue = []; this.stop(); }
    if (this.queue.length > 2) this.queue.splice(0, this.queue.length - 2);
    this.queue.push({ key, text });
    if (!this.speaking) void this.next();
  }
  repeat() { if (this.last) this.say(this.last, null, true); }

  stop() {
    try { this.current?.stop(); } catch { /* déjà arrêté */ }
    this.current = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.speaking = false;
    this.onSpeak?.(false);
  }

  private async next(): Promise<void> {
    const item = this.queue.shift();
    if (!item) { this.speaking = false; this.onSpeak?.(false); return; }
    this.speaking = true;
    this.onSpeak?.(true);
    const done = () => { void this.next(); };
    await this.manifestReady;
    if (item.key && this.manifest.has(item.key) && this.ctx && this.bus) {
      try {
        let buf = this.cache.get(item.key);
        if (!buf) {
          const r = await fetch(`audio/voix/${item.key}.mp3`);
          buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
          this.cache.set(item.key, buf);
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const g = this.ctx.createGain();
        g.gain.value = this.volume;
        src.connect(g).connect(this.bus);
        src.onended = done;
        this.current = src;
        src.start();
        return;
      } catch { /* on retombe sur la synthèse */ }
    }
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(item.text.replace(/<[^>]+>/g, ''));
      u.lang = 'fr-FR';
      if (this.frVoice) u.voice = this.frVoice;
      u.rate = 1.05; u.volume = this.volume;
      u.onend = done; u.onerror = done;
      speechSynthesis.speak(u);
    } else done();
  }
}
