#!/usr/bin/env node
/* Run the Playwright suite on a machine that has no system browser.

   The sandbox ships @sparticuz/chromium (a Chromium built for AWS Lambda) but no
   Debian NSS packages, so the browser needs two things before it can start:

     1. the Chromium binary, decompressed to /tmp by the package itself;
     2. libnss3 / libnspr4 / libnssutil3, which live in the package's own
        `bin/al2023.tar.br` — extracted to /tmp/apc-e2e-libs and pointed at with
        LD_LIBRARY_PATH.

   Usage (same arguments as `playwright test`):

       npm run test:e2e:local
       npm run test:e2e:local -- tests/finance.spec.cjs --reporter=line

   On a normal machine `npx playwright install --with-deps chromium` + `npm run
   test:e2e` is still the standard path; this script is the offline fallback. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const LIB_DIR = process.env.APC_E2E_LIBS || '/tmp/apc-e2e-libs';
const binDir = path.join(root, 'node_modules', '@sparticuz', 'chromium', 'bin');

if (!existsSync(binDir)) {
  console.error('✗ @sparticuz/chromium is missing — run: npm install');
  process.exit(1);
}

/* 1. the shared libraries the Lambda build expects (libnss3 and friends) */
const libTarget = path.join(LIB_DIR, 'lib', 'libnss3.so');
if (!existsSync(libTarget)) {
  mkdirSync(LIB_DIR, { recursive: true });
  const archive = path.join(LIB_DIR, 'al2023.tar');
  writeFileSync(archive, zlib.brotliDecompressSync(readFileSync(path.join(binDir, 'al2023.tar.br'))));
  const untar = spawn('tar', ['-xf', archive, '-C', LIB_DIR], { stdio: 'inherit' });
  untar.on('exit', code => {
    if (code !== 0) { console.error('✗ could not extract al2023.tar'); process.exit(1); }
    console.log(`✓ browser libraries → ${LIB_DIR}/lib`);
    run();
  });
} else {
  console.log(`✓ browser libraries already in ${LIB_DIR}/lib`);
  run();
}

/* 2. the browser binary, then Playwright with both paths in the environment */
async function run() {
  let chromium;
  try {
    const mod = await import('@sparticuz/chromium');
    chromium = mod.default?.default ?? mod.default;
  } catch (error) {
    console.error('✗ could not load @sparticuz/chromium:', error.message);
    process.exit(1);
  }
  const executable = await chromium.executablePath();
  console.log(`✓ chromium → ${executable}`);

  const args = process.argv.slice(2);
  const child = spawn('npx', ['playwright', 'test', ...args], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      CHROMIUM_EXECUTABLE: executable,
      LD_LIBRARY_PATH: [path.join(LIB_DIR, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
    }
  });
  child.on('exit', code => process.exit(code ?? 1));
}
