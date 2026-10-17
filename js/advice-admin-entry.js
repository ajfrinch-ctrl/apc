import { initAdviceAdmin } from './advice-admin.js';

const root = document.querySelector('[data-advice-admin]');
if (root) initAdviceAdmin(root, { role: root.dataset.adviceRole });
