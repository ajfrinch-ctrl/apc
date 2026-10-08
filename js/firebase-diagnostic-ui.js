// Active Plus — login-page Firebase diagnostic button.
(() => {
  const addButton = () => {
    const card = document.querySelector('.auth-card');
    if (!card || card.querySelector('#firebaseDiagnosticButton')) return;
    const button = document.createElement('button');
    button.id = 'firebaseDiagnosticButton';
    button.type = 'button';
    button.textContent = 'সিঙ্ক সংযোগ পরীক্ষা';
    const output = document.createElement('pre');
    output.id = 'firebaseDiagnosticOutput';
    output.hidden = true;
    output.setAttribute('role', 'status');
    button.setAttribute('aria-controls', output.id);
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'চেক হচ্ছে...';
      output.hidden = false;
      output.textContent = 'Firebase connection পরীক্ষা চলছে...';
      try {
        const { diagnoseFirebaseSync } = await import('./firebase-diagnostics.js?v=20261008-syncfix');
        const r = await diagnoseFirebaseSync();
        const mark = value => value ? 'PASS' : 'FAIL';
        const lines = [
          'SDK: ' + mark(r.sdk),
          'Database URL: ' + r.databaseURL,
          'Anonymous Authentication: ' + mark(r.authentication),
          'Firebase Connection: ' + mark(r.firebaseConnection),
          'Database Read (Rules): ' + mark(r.databaseRead),
          'Database Write (Rules): ' + r.databaseWrite,
          'LocalStorage Protected: ' + mark(r.localStorageProtected)
        ];
        if (Array.isArray(r.stages) && r.stages.length) {
          lines.push('', '— ধাপে ধাপে —');
          for (const item of r.stages) lines.push(`${item.ok ? '✓' : '✗'} ${item.id}${item.detail ? ': ' + item.detail : ''}`);
        }
        lines.push('', 'Error: ' + (r.error || 'None'));
        if (r.guidance) lines.push('', 'কী করবেন: ' + r.guidance);
        output.textContent = lines.join('\n');
      } catch (error) {
        output.textContent = 'Diagnostic error: ' + (error?.message || error);
      } finally {
        button.disabled = false;
        button.textContent = 'সিঙ্ক সংযোগ পরীক্ষা';
      }
    });
    card.append(button, output);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton, { once: true });
  else addButton();
})();
