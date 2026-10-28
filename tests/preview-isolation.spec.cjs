const { test, expect } = require('./fixtures.cjs');

test.use({ serviceWorkers: 'block' });

test('Arena preview cannot contact the production Supabase project even on explicit selection', async ({ page }) => {
  const preview = 'https://8000-synthetic-security.e2b.app';
  const productionRequests = [];
  // Serve the actual local app under a synthetic preview hostname. The routing
  // proxy runs in Playwright, not in browser-facing application code.
  await page.routeWebSocket(/wss?:\/\//, socket => {
    const hostname = new URL(socket.url()).hostname;
    if (hostname.endsWith('supabase.co') || hostname.endsWith('firebasedatabase.app')) productionRequests.push(hostname);
    socket.close();
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === preview) {
      const response = await route.fetch({ url: `http://127.0.0.1:8000${url.pathname}${url.search}` });
      return route.fulfill({ response });
    }
    if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('firebasedatabase.app')) {
      productionRequests.push(url.origin);
    }
    return route.abort();
  });
  await page.goto(`${preview}/index.html`, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    globalThis.__APC_CLOUD_PROVIDER__ = 'supabase';
    const config = await import('/sync/supabase-config.js');
    const direct = await import('/sync/supabase-transport.js');
    const transport = await import('/sync/realtime-transport.js');
    let directBlocked = false, explicitBlocked = false;
    try { direct.getSupabaseClient(); } catch { directBlocked = true; }
    try { await transport.get(transport.ref({}, 'activePlusSync/v1/students')); } catch { explicitBlocked = true; }
    return { configured: config.isSupabaseConfigured(), directBlocked, explicitBlocked };
  });
  await page.waitForLoadState('networkidle');
  expect(result).toEqual({ configured: false, directBlocked: true, explicitBlocked: true });
  expect(productionRequests).toEqual([]);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.close();
});
