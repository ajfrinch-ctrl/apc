// Surface failing Node tests in the GitHub check annotations as well as the
// full job log. This makes failures diagnosable when log downloads are blocked.
import { readFileSync } from 'node:fs';

const lines = readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const excerpts = [];
for (let i = 0; i < lines.length; i += 1) {
  if (/^(?:✖|not ok\s)/u.test(lines[i])) {
    excerpts.push(lines.slice(i, i + 24).join('\n'));
  }
}
const detail = (excerpts.join('\n---\n') || 'npm test failed; inspect the full job log.').slice(0, 18000);
const escaped = detail.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
console.log(`::error title=Node test failures::${escaped}`);
