import { build } from 'esbuild';

const common = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'eof',
};

await Promise.all([
  build({
    ...common,
    entryPoints: ['tools/vercel-observability/analytics-entry.js'],
    outfile: 'js/analytics.js',
  }),
  build({
    ...common,
    entryPoints: ['tools/vercel-observability/speed-insights-entry.js'],
    outfile: 'js/speed-insights.js',
  }),
]);

console.log('Built static Vercel Web Analytics and Speed Insights bundles.');
