// -----------------------------------------------------------------------------
// The client key: generated once under /data (mode 600), reused afterwards; a
// key pasted in the configuration rebuilt from the single line the browser
// sends; encrypted keys, wrong passphrases and public keys refused clearly.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ssh2 from 'ssh2';
import { loadClientKey, normalizePrivateKey, parsePrivateKey } from '../src/keys.js';

const { utils } = ssh2;
const flat = (pem) => pem.replace(/\r?\n/g, '');

test('the integration key is generated once, private to the container user', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gladys-ssh-key-'));
  const first = await loadClientKey({ directory, privateKey: '', passphrase: '' });
  assert.equal(first.source, 'generated');
  assert.match(first.publicLine, /^ssh-ed25519 AAAA\S+ gladys-ssh$/);
  assert.match(first.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal(statSync(join(directory, 'id_ed25519')).mode & 0o777, 0o600);
  const again = await loadClientKey({ directory, privateKey: '', passphrase: '' });
  assert.equal(again.publicLine, first.publicLine);
});

test('a key pasted on one line (browser input) is rebuilt: OpenSSH, PEM RSA, ECDSA', () => {
  for (const [type, options] of [
    ['ed25519', {}],
    ['rsa', { bits: 2048 }],
    ['ecdsa', { bits: 256 }],
  ]) {
    const pair = utils.generateKeyPairSync(type, options);
    const original = parsePrivateKey(pair.private);
    const pasted = parsePrivateKey(flat(pair.private));
    assert.equal(pasted.fingerprint, original.fingerprint, type);
    // Spaces instead of line breaks too.
    assert.equal(
      parsePrivateKey(pair.private.replace(/\n/g, ' ')).fingerprint,
      original.fingerprint,
    );
  }
  assert.equal(normalizePrivateKey('no armour'), 'no armour');
});

test('an encrypted key needs its passphrase', async () => {
  const pair = utils.generateKeyPairSync('ed25519', {
    passphrase: 'correct horse',
    cipher: 'aes256-ctr',
    rounds: 4,
  });
  assert.throws(() => parsePrivateKey(flat(pair.private)), { code: 'keyPassphrase' });
  assert.throws(() => parsePrivateKey(pair.private, 'wrong'), { code: 'keyPassphrase' });
  const key = await loadClientKey({
    directory: '/nonexistent',
    privateKey: flat(pair.private),
    passphrase: 'correct horse',
  });
  assert.equal(key.source, 'config');
  assert.equal(key.passphrase, 'correct horse');
});

test('garbage and public keys are refused', () => {
  const pair = utils.generateKeyPairSync('ed25519');
  assert.throws(() => parsePrivateKey('hello'), { code: 'keyInvalid' });
  assert.throws(() => parsePrivateKey(pair.public), { code: 'keyInvalid' });
});
