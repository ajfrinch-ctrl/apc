import { initHomeHero } from './home-hero.js';

// The cash counter is separate from the Student home hero.
if (!document.querySelector('.pay-counter-minimal')) {
  for (const root of document.querySelectorAll('[data-home-hero]')) initHomeHero(root);
}
