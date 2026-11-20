// Balayage d'endurance : plusieurs graines par thème. GRAINES=4 npx vitest run --config tools/vitest.config.ts tools/essais/balayage.test.ts
import { it } from 'vitest';
import { autoDrive } from '../../tests/autopilot.test';

it('balayage', () => {
  const n = +(process.env.GRAINES ?? 4);
  const themes = ['feux', 'priorite', 'tournants', 'giratoire', 'circulation', 'pietons'] as const;
  let ok = 0, total = 0;
  const lines: string[] = [];
  for (const th of themes) for (let k = 0; k < n; k++) {
    const seed = 101 + k * 17;
    let r;
    try { r = autoDrive(th as any, seed); } catch (e) { lines.push(`${th} ${seed} : erreur ${(e as Error).message}`); total++; continue; }
    total++;
    const good = r.done && r.graves === 0 && !r.collisions.length;
    if (good) ok++;
    lines.push(`${good ? 'ok ' : 'KO '} ${th} ${seed} fini=${r.done} t=${Math.round(r.time)} arrêtMax=${Math.round(r.maxStuck)} fautes=[${r.faults.join(', ')}] chocs=[${r.collisions.join(',')}] ${r.done ? '' : r.lastReason}`);
  }
  console.log(lines.join('\n'));
  console.log(`BILAN ${ok}/${total} trajets sans faute grave ni accrochage`);
});
