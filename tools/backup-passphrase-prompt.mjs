/* Offline tools must never receive backup passphrases in arguments, environment
   variables, logs or files. Prompt silently on the operator's terminal only. */
import { createInterface } from 'node:readline/promises';

export async function promptBackupPassphrase(payload, label = 'Backup') {
  if (payload?.version !== 3) return '';
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error('INTERACTIVE_BACKUP_PASSPHRASE_REQUIRED');
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  const output = rl.output;
  try {
    process.stderr.write(`${label} passphrase: `);
    rl.output = { write: () => true };
    return await rl.question('');
  } finally {
    rl.output = output;
    process.stderr.write('\n');
    rl.close();
  }
}
