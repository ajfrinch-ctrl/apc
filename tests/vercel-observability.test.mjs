import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pages = ['index.html', 'student.html', 'admin.html', 'manager.html', 'teacher.html', 'payment.html', 'privacy.html'];
const speedInsightPages = pages.filter(page => page !== 'privacy.html');
const staffPages = ['admin.html', 'manager.html', 'teacher.html', 'payment.html'];

function policyFor(html) {
  return html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/i)?.[1] || '';
}

function executeBundle(path, hostname = 'localhost') {
  const scripts = [];
  const window = {
    location: { hostname, pathname: '/student.html', origin: 'https://apc.example' }
  };
  const document = {
    head: { querySelector: () => null, appendChild: script => scripts.push(script) },
    createElement: tagName => ({ tagName, dataset: {} })
  };
  runInNewContext(read(path), { window, document, console });
  return { window, scripts };
}

test('Vercel observability packages, lockfile and privacy-safe static bundles are aligned', () => {
  const packageJson = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(packageJson.dependencies['@vercel/analytics'], '^2.0.1');
  assert.equal(packageJson.dependencies['@vercel/speed-insights'], '^2.0.0');
  assert.equal(lock.packages[''].dependencies['@vercel/analytics'], '^2.0.1');
  assert.equal(lock.packages[''].dependencies['@vercel/speed-insights'], '^2.0.0');
  assert.equal(lock.packages['node_modules/@vercel/analytics'].version, '2.0.1');
  assert.equal(lock.packages['node_modules/@vercel/speed-insights'].version, '2.0.0');

  for (const path of ['js/analytics.js', 'js/speed-insights.js']) {
    const bundle = read(path);
    assert.doesNotMatch(bundle, /node_modules\//, `${path} must work in the static deployment`);
    assert.match(bundle, /beforeSend/);
    assert.match(bundle, /\/other/);
    assert.match(bundle, /student\.html/);
  }
  const analyticsSource = read('tools/vercel-observability/analytics-entry.js');
  const speedSource = read('tools/vercel-observability/speed-insights-entry.js');
  for (const source of [analyticsSource, speedSource]) {
    assert.match(source, /safePagePath/);
    assert.match(source, /location\.origin/);
    assert.match(source, /isLocalPreview/);
    assert.match(source, /\.e2b\.app/);
    assert.doesNotMatch(source, /location\.(?:search|hash)/);
    assert.doesNotMatch(source, /track\s*\(/, 'no custom events or private form data are sent');
  }
});

test('bundles skip non-Vercel local previews and strip dynamic URL/private fields before production telemetry', () => {
  for (const path of ['js/analytics.js', 'js/speed-insights.js']) {
    assert.deepEqual(executeBundle(path).scripts, [], `${path} does not request a missing localhost Vercel endpoint`);
    assert.deepEqual(executeBundle(path, 'arena-preview.e2b.app').scripts, [], `${path} skips Arena preview ingestion`);
  }

  for (const [path, queueName] of [['js/analytics.js', 'vaq'], ['js/speed-insights.js', 'siq']]) {
    const { window, scripts } = executeBundle(path, 'apc.example');
    assert.equal(scripts.length, 1, `${path} injects the production Vercel script once`);
    assert.match(scripts[0].src, /^\/_vercel\//);
    const beforeSend = window[queueName].find(([name]) => name === 'beforeSend')?.[1];
    assert.equal(typeof beforeSend, 'function', `${path} installs privacy middleware before loading`);
    const clean = beforeSend({
      type: 'pageview',
      url: 'https://apc.example/student.html?studentId=private#profile',
      privateField: 'must not be forwarded'
    });
    assert.equal(clean.url, 'https://apc.example/student.html');
    assert.equal(clean.route === undefined ? undefined : clean.route, path === 'js/speed-insights.js' ? '/student.html' : undefined);
    assert.equal(Object.hasOwn(clean, 'privateField'), false);
  }
});

test('all planned pages load each observability bundle once and CSP remains narrowly scoped', () => {
  const config = JSON.parse(read('vercel.json'));
  const csp = config.headers.find(({ headers }) => headers.some(header => header.key === 'Content-Security-Policy'))
    .headers.find(header => header.key === 'Content-Security-Policy').value;
  assert.equal((csp.match(/https:\/\/va\.vercel-scripts\.com/g) || []).length, 2);
  assert.match(csp, /script-src[^;]*https:\/\/va\.vercel-scripts\.com/);
  assert.match(csp, /connect-src[^;]*https:\/\/va\.vercel-scripts\.com/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);

  for (const page of pages) {
    const html = read(page);
    assert.equal((html.match(/js\/analytics\.js/g) || []).length, 1, `${page}: analytics loaded exactly once`);
    const policy = policyFor(html);
    if (policy) {
      assert.match(policy, /script-src[^;]*https:\/\/va\.vercel-scripts\.com/, `${page}: script host allowed`);
      assert.match(policy, /connect-src[^;]*https:\/\/va\.vercel-scripts\.com/, `${page}: connection host allowed`);
      assert.equal((policy.match(/https:\/\/va\.vercel-scripts\.com/g) || []).length, 2, `${page}: no duplicate CSP source`);
    }
  }
  for (const page of speedInsightPages) {
    assert.equal((read(page).match(/js\/speed-insights\.js/g) || []).length, 1, `${page}: speed insights loaded exactly once`);
  }
});

test('staff-only panel assets are not eagerly referenced by Student or landing HTML', () => {
  for (const page of ['index.html', 'student.html']) {
    const html = read(page);
    for (const asset of ['staff-navigation.js', 'staff-panel-theme.js', 'staff-daily-advice.js']) {
      assert.doesNotMatch(html, new RegExp(asset.replaceAll('.', '\\.')), `${page} must stay lean`);
    }
  }
  for (const page of staffPages) {
    assert.match(read(page), /staff-panel-theme\.js/);
  }
});
