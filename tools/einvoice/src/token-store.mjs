import { readFile, writeFile, unlink, chmod } from 'node:fs/promises';

/** Persists the session (AuthToken + SEK) to a JSON file with 0600 permissions. */
export class FileTokenStore {
  constructor(path) {
    this.path = path;
  }
  async load() {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }
  async save(session) {
    await writeFile(this.path, JSON.stringify(session, null, 2), { mode: 0o600 });
    await chmod(this.path, 0o600).catch(() => {});
  }
  async clear() {
    await unlink(this.path).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
}
