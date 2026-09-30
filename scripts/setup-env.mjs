import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const path = fileURLToPath(new URL('.env', root));
let content = readFileSync(existsSync(path) ? path : new URL('.env.example', root), 'utf8');
if (!/^AUTH_SECRET=.+$/m.test(content)) {
  const setting = `AUTH_SECRET=${randomBytes(32).toString('hex')}`;
  content = /^AUTH_SECRET=.*$/m.test(content) ? content.replace(/^AUTH_SECRET=.*$/m, setting) : `${content.trimEnd()}\n${setting}\n`;
}
writeFileSync(path, content, { mode: 0o600 });
chmodSync(path, 0o600);
console.info('Local .env is ready. Existing settings and signing secrets were preserved.');
