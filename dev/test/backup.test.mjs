// Qué copias de Drive se borran: se quedan las de los últimos 14 días y la más vieja de cada mes.
import { copiesToDelete } from '../../js/backup.js';
const names = [];
for (let d = new Date('2026-07-01T12:00:00'); d <= new Date('2026-10-20T12:00:00'); d.setDate(d.getDate() + 1)) names.push(`ApexTrack_copia_${d.toISOString().slice(0, 10)}.json`);
names.push('ApexTrack_copia_2026-10-20_reducida.json');
const del = new Set(copiesToDelete(names, '2026-10-20'));
const kept = names.filter((n) => !del.has(n)).map((n) => n.slice(16, 26));
const okRecent = names.filter((n) => n >= 'ApexTrack_copia_2026-10-06').every((n) => !del.has(n));
const okMonthly = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'].every((d) => kept.includes(d));
console.log(`${okRecent ? '✓' : '✗'} Se quedan las de los últimos 14 días`);
console.log(`${okMonthly ? '✓' : '✗'} Se queda una por mes: ${kept.filter((d) => d < '2026-10-06').join(', ')}`);
console.log(`${kept.length === 15 + 1 + 4 ? '✓' : '✗'} Total conservadas: ${kept.length} de ${names.length}`);
