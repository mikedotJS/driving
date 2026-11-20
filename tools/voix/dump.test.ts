// Exporte toutes les répliques du moniteur (clé → texte) pour l'enregistrement des voix :
//   npx vitest run tools/voix/dump.test.ts
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { INFRACTIONS } from '../../src/rules/infractions';
import { LESSONS, EXAM, FREE } from '../../src/game/lessons';
import { allInstructions } from '../../src/map/route';

it('exporte les répliques', () => {
  const lines: Record<string, string> = {};
  for (const inf of Object.values(INFRACTIONS)) lines[inf.id] = inf.moniteur;
  for (const l of [...LESSONS, EXAM, FREE]) lines['intro_' + l.id] = l.intro;
  for (const l of LESSONS.filter((x) => x.theme === 'bases' || x.theme === 'allure')) {
    l.steps.forEach((st, i) => { if (i > 0) lines[`step_${l.id}_${i}`] = (typeof st.text === 'function' ? st.text(false) : st.text) + '.'; });
  }
  for (const ins of allInstructions()) lines[ins.key] = ins.spoken;
  Object.assign(lines, {
    bravo_pieton: 'Bien : vous laissez traverser le piéton.',
    recalcul: 'Ce n’est pas la bonne rue, mais ce n’est pas grave : je recalcule.',
    fin_lecon: 'Très bien, la leçon est terminée.',
    fin_examen: 'L’épreuve de conduite est terminée. Passons aux questions.',
  });
  writeFileSync(new URL('./repliques.json', import.meta.url), JSON.stringify(lines, null, 1));
  const chars = Object.values(lines).reduce((s, t) => s + t.length, 0);
  console.log(`${Object.keys(lines).length} répliques, ${chars} caractères`);
});
