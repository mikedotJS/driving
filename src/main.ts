// Point d'entrée : écran de chargement puis lancement du jeu.

import { Game, LESSONS, EXAM, FREE } from './game/game';

const bar = document.getElementById('loadbar') as HTMLElement;
const msg = document.getElementById('loadmsg') as HTMLElement;
const loading = document.getElementById('loading') as HTMLElement;

const game = new Game();
// accès pour la mise au point et les essais automatisés
(window as unknown as Record<string, unknown>).__game = game;
(window as unknown as Record<string, unknown>).__lessons = { LESSONS, EXAM, FREE };

game.init((ratio, text) => {
  bar.style.width = `${Math.round(ratio * 100)}%`;
  msg.textContent = text;
}).then(() => {
  loading.style.display = 'none';
  (window as unknown as Record<string, unknown>).__ready = true;
  // démarrage direct pour les essais : ?start=libre | examen | <identifiant de leçon>
  const q = new URLSearchParams(location.search).get('start');
  if (q) {
    const l = q === 'libre' ? FREE : q === 'examen' ? EXAM : LESSONS.find((x) => x.id === q);
    if (l) game.start(l);
  }
}).catch((e) => {
  console.error(e);
  msg.textContent = 'Erreur de chargement : ' + (e?.message ?? e);
  msg.style.color = '#ff9a9a';
});
