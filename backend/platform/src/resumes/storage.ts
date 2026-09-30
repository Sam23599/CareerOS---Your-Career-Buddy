import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface ResumeStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export class LocalResumeStorage implements ResumeStorage {
  constructor(private directory: string) {}
  private path(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid storage key.');
    return join(this.directory, key);
  }
  async put(key: string, data: Buffer) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(this.path(key), data, { flag: 'wx', mode: 0o600 });
  }
  get(key: string) { return readFile(this.path(key)); }
  async remove(key: string) { await rm(this.path(key), { force: true }); }
}
