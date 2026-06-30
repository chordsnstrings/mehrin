import { build, context } from 'esbuild';

/** Bundles the TypeScript client into a single ESM file for the browser. */
const options = {
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/public/main.js',
  bundle: true,
  format: 'esm',
  target: ['es2019'],
  minify: true,
  sourcemap: true,
  logLevel: 'info',
};

const watch = process.argv.includes('--watch');

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[client] watching for changes…');
} else {
  await build(options);
}
