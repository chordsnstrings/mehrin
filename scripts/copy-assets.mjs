import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

/** Copies static client assets into the build output (dist/public). */
const OUT = 'dist/public';

// A changed client gets a new URL. Even an older installed service worker cannot
// mistake yesterday's JavaScript for the code required by today's HTML.
const hash = (content) => createHash('sha256').update(content).digest('hex').slice(0, 16);
const client = await readFile(`${OUT}/main.js`);
const styles = await readFile('src/client/styles.css');
const clientUrl = `/main.${hash(client)}.js`;
const stylesUrl = `/styles.${hash(styles)}.css`;
await writeFile(`${OUT}${clientUrl}`, client);
await writeFile(`${OUT}${stylesUrl}`, styles);

const html = (await readFile('src/client/index.html', 'utf8'))
  .replace('src="/main.js"', `src="${clientUrl}"`)
  .replace('href="/styles.css"', `href="${stylesUrl}"`);
await writeFile(`${OUT}/index.html`, html);

const worker = await readFile('src/client/sw.js', 'utf8');
const release = hash(Buffer.concat([client, styles, Buffer.from(html), Buffer.from(worker)]));
await writeFile(`${OUT}/sw.js`, worker
  .replaceAll('__RELEASE__', release)
  .replaceAll('__CLIENT_URL__', clientUrl)
  .replaceAll('__STYLES_URL__', stylesUrl));

const files = [
  // Keep these unversioned URLs working for clients from earlier releases.
  ['src/client/styles.css', `${OUT}/styles.css`],
  ['src/client/manifest.webmanifest', `${OUT}/manifest.webmanifest`],
];

await mkdir(OUT, { recursive: true });

for (const [from, to] of files) {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to);
}

// Icons directory (PNGs + SVG sources).
await cp('src/client/icons', `${OUT}/icons`, { recursive: true });

console.log(`[assets] copied static files to ${OUT}`);
