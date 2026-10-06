/* Static dead-call guard used by the dead-reference cleanup (Phase 8).

   Flags a call to an identifier the file neither imports nor declares, which is
   exactly the failure mode of a UI cleanup: markup disappears, the module keeps
   writing to it, and every browser test still passes because nothing rendered
   that path. Run it before a release:

       node tools/undefined-call-check.mjs js/*.js

   Exit code is 1 when any file has an unknown call. Browser globals, comments,
   strings and regex literals are accounted for; dynamic `import()` destructuring
   and object/class method shorthand count as declarations. */
import { readFileSync } from 'node:fs';

const GLOBALS = new Set(`if for while switch catch function return typeof new delete void in of
instanceof do else try throw case break continue default class extends super this null true false
undefined NaN Infinity var let const import export await async yield window document console
setTimeout clearTimeout setInterval clearInterval queueMicrotask requestAnimationFrame
cancelAnimationFrame fetch localStorage sessionStorage navigator location history alert confirm
prompt JSON Math Date Number String Boolean Object Array Set Map WeakMap WeakSet Promise Error
TypeError ReferenceError SyntaxError RangeError Symbol BigInt RegExp Function Intl URL URLSearchParams
Blob File FormData Headers Request Response AbortController TextEncoder TextDecoder crypto
performance customElements HTMLElement Node NodeList Element Event CustomEvent MouseEvent
KeyboardEvent EventTarget MutationObserver IntersectionObserver ResizeObserver getComputedStyle
matchMedia structuredClone btoa atob encodeURIComponent decodeURIComponent encodeURI decodeURI
parseInt parseFloat isNaN isFinite escape unescape globalThis self top parent frames caches indexedDB
IDBKeyRange firebase CDN Number.isSafeInteger Uint8Array Int8Array Uint16Array Int16Array
Uint32Array Int32Array Float32Array Float64Array ArrayBuffer DataView WeakRef FinalizationRegistry
Option Image FontFace Audio Worker WebSocket EventSource AbortSignal DOMException Range DOMParser
XMLSerializer FileReader ImageData Path2D CanvasRenderingContext2D AudioContext IDBFactory`.split(/\s+/));

const KEYWORDS = new Set(['if','for','while','switch','catch','function','return','typeof','new','await','of','in','do','else','delete','void','instanceof','super','class','import','export','yield','async','case','throw','try','default']);

/* Blank the parts of the source that are prose rather than code, so a call-like
   word inside a comment or a string never looks like a call. */
function codeOnly(raw) {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+\/[gimsuy]*/g, 'RE');
}

/* Text inside the parens that open at `open`, plus the index just past the close. */
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (!depth) return { text: src.slice(open + 1, i), end: i + 1 }; }
  }
  return { text: '', end: src.length };
}

function addParams(defined, list) {
  for (let token of list.split(',')) {
    token = token.trim().replace(/=.*$/, '').trim();                 // drop default values
    token = token.replace(/^[{[]/, '').replace(/[}\]]$/, '').trim();// strip destructuring braces
    token = token.split(':').at(-1).trim();                         // { a: local } -> local
    token = token.split(/\bas\b/).at(-1).trim();                     // { a as local } -> local
    if (/^[\w$]+$/.test(token)) defined.add(token);
  }
}

function declaredNames(src) {
  const defined = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}/g)) addParams(defined, m[1]);
  for (const m of src.matchAll(/import\s+(\w+)\s+from/g)) defined.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var|class|function)\s+([\w$]+)/g)) defined.add(m[1]);
  for (const m of src.matchAll(/(?:const|let)\s*\{([^{}]*)\}\s*=/g)) addParams(defined, m[1]);  // const { a } = …
  for (const m of src.matchAll(/(?:const|let)\s*\[([^{}\]]*)\]\s*=/g)) addParams(defined, m[1]); // const [a] = …
  for (const m of src.matchAll(/(?<![\w$.])([\w$]+)\s*=>/g)) defined.add(m[1]);          // x => …
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) addParams(defined, m[1]);          // (a, b) => …
  for (const m of src.matchAll(/catch\s*\(\s*([\w$]+)/g)) defined.add(m[1]);
  for (const m of src.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([\w$]+)/g)) defined.add(m[1]);
  // `name(params) {` — a function declaration or object/class method (params may
  // contain parens of their own, e.g. `receiptDate = new Date()`).
  for (const m of src.matchAll(/(?<![\w$.])([\w$]+)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const { text, end } = balanced(src, open);
    let after = end;
    while (after < src.length && /\s/.test(src[after])) after++;
    if (src[after] === '{') { defined.add(m[1]); addParams(defined, text); }
  }
  // Destructured assignments and defaults: `const { a } = …`, `({ b } = {})`.
  for (const m of src.matchAll(/[{,;(\n]\s*([\w$]+)\s*=(?!=)/g)) defined.add(m[1]);
  return defined;
}

let bad = 0;
for (const file of process.argv.slice(2)) {
  const defined = declaredNames(codeOnly(readFileSync(file, 'utf8')));
  const calls = new Set([...codeOnly(readFileSync(file, 'utf8')).matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
  const unknown = [...calls].filter(c => !KEYWORDS.has(c) && !defined.has(c) && !GLOBALS.has(c)).sort();
  console.log(`${unknown.length ? 'CHECK' : 'OK   '} ${file}${unknown.length ? ' → ' + unknown.join(', ') : ''}`);
  bad += unknown.length;
}
process.exit(bad ? 1 : 0);
