// Copy the static module assets alongside the Vite-built bundle so `dist/` is the
// exact tree Foundry installs: module.json + scripts/ + styles/ + lang/ + templates/.
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const dist = path.join(root, 'dist');

await mkdir(dist, { recursive: true });
await cp(path.join(root, 'module.json'), path.join(dist, 'module.json'));
await cp(path.join(root, 'styles'), path.join(dist, 'styles'), { recursive: true });
await cp(path.join(root, 'lang'), path.join(dist, 'lang'), { recursive: true });
await cp(path.join(root, 'templates'), path.join(dist, 'templates'), { recursive: true });

console.log('assembled dist/ (module.json + scripts + styles + lang + templates)');
