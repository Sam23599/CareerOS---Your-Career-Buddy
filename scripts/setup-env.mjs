import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const path = fileURLToPath(new URL('.env', root));
let content = readFileSync(existsSync(path) ? path : new URL('.env.example', root), 'utf8');
for (const key of ['AUTH_SECRET', 'INTELLIGENCE_SERVICE_TOKEN', 'INTELLIGENCE_DB_PASSWORD']) {
  if (!new RegExp(`^${key}=.+$`, 'm').test(content)) {
    const setting = `${key}=${randomBytes(32).toString('hex')}`;
    const line = new RegExp(`^${key}=.*$`, 'm');
    content = line.test(content) ? content.replace(line, setting) : `${content.trimEnd()}\n${setting}\n`;
  }
}
if (!/^INTELLIGENCE_SERVICE_URL=/m.test(content)) content += 'INTELLIGENCE_SERVICE_URL=http://127.0.0.1:8000\n';
writeFileSync(path, content, { mode: 0o600 });
chmodSync(path, 0o600);
console.info('Local .env is ready. Existing settings and signing secrets were preserved.');
