// Market values from an earlier build, in fetch_tm.py's output format, for a rebuild
// when Transfermarkt cannot be fetched: node keep_values.mjs <old players.js> <out tm.json>
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [src, out] = process.argv.slice(2);
const { PLAYERS } = await import(pathToFileURL(resolve(src)).href);
const tm = {};
for (const p of PLAYERS) if (p.mv) tm[p.id.replace(/^ea-/, '')] = { tmId: 'kept', value: p.mv, date: p.mvDate };
writeFileSync(out, JSON.stringify(tm));
console.log(`${Object.keys(tm).length} market values kept -> ${out}`);
