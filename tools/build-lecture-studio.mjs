// Deterministic, same-origin Tiptap + ProseMirror + KaTeX bundle for Active Plus Lecture Sheet Studio.
// Lazy-loaded on demand when opening the Full-Screen Lecture Sheet Editor; never part of eager boot.
// Rebuild with: npm run build:lecture-studio
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'vendor/lecture-studio'), { recursive: true });

const entry = `
export { Editor, Extension, Node, Mark, mergeAttributes } from '@tiptap/core';
export { Plugin, PluginKey } from '@tiptap/pm/state';
export { Decoration, DecorationSet } from '@tiptap/pm/view';
export { StarterKit } from '@tiptap/starter-kit';
export { Underline } from '@tiptap/extension-underline';
export { TextStyle } from '@tiptap/extension-text-style';
export { Color } from '@tiptap/extension-color';
export { Highlight } from '@tiptap/extension-highlight';
export { TextAlign } from '@tiptap/extension-text-align';
export { Subscript } from '@tiptap/extension-subscript';
export { Superscript } from '@tiptap/extension-superscript';
export { Table } from '@tiptap/extension-table';
export { TableRow } from '@tiptap/extension-table-row';
export { TableHeader } from '@tiptap/extension-table-header';
export { TableCell } from '@tiptap/extension-table-cell';
export { Image } from '@tiptap/extension-image';
export { Placeholder } from '@tiptap/extension-placeholder';
import katex from 'katex';
export { katex };
export function renderLatexMathML(latex, displayMode = false) {
  return katex.renderToString(String(latex || ''), {
    output: 'mathml',
    displayMode: Boolean(displayMode),
    throwOnError: false,
    strict: 'ignore'
  });
}
`;

await build({
  stdin: {
    contents: entry,
    resolveDir: root,
    sourcefile: 'lecture-studio-sdk-entry.js'
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  banner: {
    js: '/* Bundled from @tiptap/* & katex (MIT). Rebuild with: npm run build:lecture-studio */'
  },
  outfile: resolve(root, 'vendor/lecture-studio/sdk.js')
});
