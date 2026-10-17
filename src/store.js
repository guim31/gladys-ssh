// -----------------------------------------------------------------------------
// Small persistence under /data (the only writable path of the container): the
// hosts and their commands, the host key fingerprints learned on first contact,
// and the last known reachability (so a restart does not fire the triggers
// again). The file holds the optional per-host passwords: /data is the
// integration's private volume, never in a log nor in an action result.
// -----------------------------------------------------------------------------

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'ssh-store' });
const FILE_NAME = 'state.json';

export class Store {
  constructor(directory = process.env.SSH_DATA_DIR || '/data') {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.pending = null;
    this.writing = null;
    // A failing disk would fail every save: logged once, then at debug.
    this.writeFailed = false;
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch (err) {
      if (err.code === 'ENOENT') {
        return {};
      }
      // Never overwrite a file that could not be read: the hosts, passwords
      // and host keys it holds would be lost, and the keys learned again
      // without warning. A corrupt file is set aside; an unreadable one
      // blocks the writes.
      if (err instanceof SyntaxError) {
        const aside = `${this.path}.bad-${Date.now()}`;
        await rename(this.path, aside).catch(() => {
          this.blocked = true;
        });
        logger.error(`${this.path} is corrupt, set aside as ${aside}`);
      } else {
        this.blocked = true;
        logger.error(`Cannot read ${this.path}: ${err.message}; nothing will be written`);
      }
      return {};
    }
  }

  // Writes are coalesced and atomic (temporary file + rename): a crash never
  // leaves half a JSON file behind.
  save(data) {
    if (this.blocked) {
      return Promise.resolve();
    }
    this.latest = data;
    if (!this.pending) {
      // Chained after the write in progress, if any: one writer at a time.
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        const snapshot = this.latest;
        this.pending = null;
        try {
          await mkdir(this.directory, { recursive: true });
          const temporary = `${this.path}.tmp`;
          await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
          await chmod(temporary, 0o600);
          await rename(temporary, this.path);
          if (this.writeFailed) {
            this.writeFailed = false;
            logger.info(`${this.path} written again`);
          }
        } catch (err) {
          if (this.writeFailed) {
            logger.debug(`Cannot write ${this.path}: ${err.message}`);
          } else {
            this.writeFailed = true;
            logger.warn(`Cannot write ${this.path}: ${err.message}`);
          }
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  /** Resolves once every write requested so far is on disk. */
  flush() {
    return this.writing ?? Promise.resolve();
  }
}
