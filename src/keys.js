// -----------------------------------------------------------------------------
// The client key of the integration.
//
// By default the integration generates its own Ed25519 key pair at the first
// start and keeps it under /data (the only writable path): the user copies the
// public key to `~/.ssh/authorized_keys` on each machine, and no private key
// ever goes through a form. A user who prefers their own key pastes it in the
// `private_key` secret field.
//
// A pasted key arrives on ONE line: browsers strip the line breaks of a
// single-line input (`<input type="password">`, HTML value sanitization), so
// "-----BEGIN…-----\nb3Bl…\n-----END…-----" becomes "-----BEGIN…-----b3Bl…-----END…-----".
// normalizePrivateKey() rebuilds the armour before parsing. Legacy encrypted
// PEM keys (with Proc-Type/DEK-Info headers) cannot be rebuilt that way: the
// documentation asks for an OpenSSH or unencrypted PEM key.
//
// The private key is never logged, nor shown: only the public key and its
// fingerprint are.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ssh2 from 'ssh2';

const { utils } = ssh2;

export const KEY_COMMENT = 'gladys-ssh';
const PRIVATE_FILE = 'id_ed25519';

const ARMOUR = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/;

/** OpenSSH-style fingerprint of a public key blob: "SHA256:base64-without-padding". */
export function fingerprint(blob) {
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}

/**
 * Rebuilds the line breaks of a private key pasted in a single-line field.
 * Returns the text unchanged when it has no recognizable armour.
 */
export function normalizePrivateKey(text) {
  const source = String(text ?? '').trim();
  const match = ARMOUR.exec(source);
  if (!match) {
    return source;
  }
  const [, label, rawBody] = match;
  const body = rawBody.replace(/\s+/g, '');
  const width = label === 'OPENSSH PRIVATE KEY' ? 70 : 64;
  const lines = body.match(new RegExp(`.{1,${width}}`, 'g')) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/**
 * Parses a private key; throws an Error with a `code` the messages know
 * ('keyInvalid', 'keyPassphrase') rather than the details of the parser.
 */
export function parsePrivateKey(text, passphrase) {
  const normalized = normalizePrivateKey(text);
  let parsed;
  try {
    parsed = utils.parseKey(normalized, passphrase || undefined);
  } catch {
    parsed = null;
  }
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!key || key instanceof Error) {
    const encrypted = key instanceof Error && /passphrase|encrypted/i.test(key.message);
    const error = new Error(encrypted ? 'Wrong or missing passphrase' : 'Unreadable private key');
    error.code = encrypted ? 'keyPassphrase' : 'keyInvalid';
    throw error;
  }
  if (typeof key.isPrivateKey === 'function' && !key.isPrivateKey()) {
    const error = new Error('Not a private key');
    error.code = 'keyInvalid';
    throw error;
  }
  const blob = key.getPublicSSH();
  return {
    privateKey: normalized,
    publicLine: `${key.type} ${blob.toString('base64')} ${KEY_COMMENT}`,
    fingerprint: fingerprint(blob),
  };
}

/**
 * The client key in use: the pasted one when the configuration has it, else
 * the integration's own key, generated once and kept under `directory`.
 * @returns {Promise<{privateKey: string, passphrase?: string, publicLine: string, fingerprint: string, source: 'config'|'generated'}>}
 */
export async function loadClientKey({ directory, privateKey, passphrase }) {
  if (privateKey) {
    const parsed = parsePrivateKey(privateKey, passphrase);
    return { ...parsed, passphrase: passphrase || undefined, source: 'config' };
  }
  const path = join(directory, PRIVATE_FILE);
  let text = null;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
  if (text === null) {
    const pair = utils.generateKeyPairSync('ed25519', { comment: KEY_COMMENT });
    text = pair.private;
    await mkdir(directory, { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, text, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  }
  return { ...parsePrivateKey(text), source: 'generated' };
}
