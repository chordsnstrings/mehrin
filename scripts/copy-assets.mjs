import { cp, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Copies static client assets into the build output (dist/public). */
const OUT = 'dist/public';

const files = [
  ['src/client/index.html', `${OUT}/index.html`],
  ['src/client/styles.css', `${OUT}/styles.css`],
  ['src/client/manifest.webmanifest', `${OUT}/manifest.webmanifest`],
  ['src/client/sw.js', `${OUT}/sw.js`],
];

await mkdir(OUT, { recursive: true });

for (const [from, to] of files) {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to);
}

// Icons directory (PNGs + SVG sources).
await cp('src/client/icons', `${OUT}/icons`, { recursive: true });

console.log(`[assets] copied static files to ${OUT}`);
