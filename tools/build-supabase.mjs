// Deterministic, same-origin Supabase JS SDK bundle for Active Plus Coaching.
// Run `npm run build:supabase` after upgrading @supabase/supabase-js.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'vendor/supabase'), { recursive: true });

await build({
  stdin: {
    contents: `export { createClient } from '@supabase/supabase-js';\n`,
    resolveDir: root,
    sourcefile: 'supabase-sdk-entry.js'
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  banner: {
    js: '/* Bundled from @supabase/supabase-js (MIT). Rebuild with: npm run build:supabase */'
  },
  outfile: resolve(root, 'vendor/supabase/sdk.js')
});
