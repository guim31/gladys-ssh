// -----------------------------------------------------------------------------
// One SSH session: connect, verify the host key, authenticate, run a list of
// commands one after the other, close. At a cadence of minutes, a session per
// cycle is simpler and more robust than a connection kept open (a machine that
// reboots, a NAT that forgets idle flows).
//
// Host key: trust on first use. The fingerprint learned at the first contact is
// stored by the caller; a later session with another key is refused before
// authentication (no password nor signature is sent to an impostor).
//
// Commands: each one has a timeout and an output cap. The command text is sent
// as is, as `ssh host 'command'` would: it only ever comes from the
// configuration, never from a scene or a widget (see src/monitor.js). On a
// timeout the channel gets a KILL signal (honoured by OpenSSH 7.9+ for
// commands without a terminal) and is closed.
// -----------------------------------------------------------------------------

import ssh2 from 'ssh2';
import { fingerprint } from './keys.js';

const { Client } = ssh2;

export const CONNECT_TIMEOUT_MS = 10_000;
export const MAX_OUTPUT_BYTES = 64 * 1024;

/** An error whose `code` says what went wrong, for messages and triggers. */
export class SshError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

// Reasons, also the `reason` variable of the "Host unreachable" trigger.
export const REASONS = [
  'timeout',
  'refused',
  'unreachable',
  'dns',
  'auth',
  'host_key_changed',
  'error',
];

function classify(err, state) {
  if (state.hostKeyChanged) {
    return new SshError('host_key_changed', 'The host key changed', {
      expected: state.expected,
      received: state.received,
    });
  }
  if (err?.level === 'client-authentication') {
    return new SshError('auth', 'Authentication failed');
  }
  if (err?.level === 'client-timeout' || err?.code === 'ETIMEDOUT') {
    return new SshError('timeout', 'No answer');
  }
  switch (err?.code) {
    case 'ECONNREFUSED':
      return new SshError('refused', 'Connection refused');
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EHOSTDOWN':
      return new SshError('unreachable', 'Host unreachable');
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new SshError('dns', 'Unknown host name');
    default:
      return new SshError('error', err?.message || 'SSH error');
  }
}

function append(buffer, chunk, max) {
  if (buffer.length >= max) {
    return { buffer, truncated: true };
  }
  const room = max - buffer.length;
  return chunk.length > room
    ? { buffer: Buffer.concat([buffer, chunk.subarray(0, room)]), truncated: true }
    : { buffer: Buffer.concat([buffer, chunk]), truncated: false };
}

function execOne(client, { command, timeoutMs, maxBytes = MAX_OUTPUT_BYTES }) {
  return new Promise((resolve) => {
    const started = Date.now();
    client.exec(command, (err, stream) => {
      if (err) {
        resolve({ code: null, stdout: '', stderr: err.message, timedOut: false, error: true });
        return;
      }
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let truncated = false;
      let timedOut = false;
      let done = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          stream.signal('KILL');
        } catch {
          // Not every server accepts signals: closing is enough on our side.
        }
        stream.close();
        // A server that never confirms the close must not hold the caller.
        setTimeout(finish, 1000, null, null).unref?.();
      }, timeoutMs);
      const finish = (code, signal) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        resolve({
          code: timedOut ? null : (code ?? null),
          signal: signal ?? null,
          stdout: stdout.toString('utf8'),
          stderr: stderr.toString('utf8'),
          timedOut,
          truncated,
          durationMs: Date.now() - started,
        });
      };
      stream.on('data', (chunk) => {
        const next = append(stdout, chunk, maxBytes);
        stdout = next.buffer;
        truncated ||= next.truncated;
      });
      stream.stderr.on('data', (chunk) => {
        const next = append(stderr, chunk, maxBytes);
        stderr = next.buffer;
        truncated ||= next.truncated;
      });
      stream.on('close', finish);
    });
  });
}

/**
 * @param {object} target `{ address, port, username, password? }`
 * @param {Array<{command: string, timeoutMs: number, maxBytes?: number}>} commands
 * @param {object} options
 * @param {object} options.key `{ privateKey, passphrase? }` from src/keys.js
 * @param {string|null} options.knownFingerprint stored host key, null on first contact
 * @param {number} [options.connectTimeoutMs]
 * @returns {Promise<{fingerprint: string, results: object[]}>}
 * @throws {SshError}
 */
export function runSession(target, commands, options) {
  const { key, knownFingerprint = null, connectTimeoutMs = CONNECT_TIMEOUT_MS } = options;
  const state = { hostKeyChanged: false, expected: knownFingerprint, received: null };
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const fail = (err) => {
      if (settled) {
        return;
      }
      settled = true;
      client.end();
      reject(err instanceof SshError ? err : classify(err, state));
    };
    client.on('error', fail);
    client.on('close', () => fail(new SshError('error', 'Connection closed')));
    client.on('ready', async () => {
      const results = [];
      for (const entry of commands) {
        results.push(await execOne(client, entry));
      }
      settled = true;
      client.end();
      resolve({ fingerprint: state.received, results });
    });
    const auths = ['publickey', ...(target.password ? ['password'] : [])];
    try {
      client.connect({
        host: target.address,
        port: target.port || 22,
        username: target.username,
        privateKey: key?.privateKey,
        passphrase: key?.passphrase,
        password: target.password || undefined,
        authHandler: auths,
        readyTimeout: connectTimeoutMs,
        keepaliveInterval: 0,
        hostVerifier: (blob) => {
          state.received = fingerprint(blob);
          if (knownFingerprint && knownFingerprint !== state.received) {
            state.hostKeyChanged = true;
            return false;
          }
          return true;
        },
      });
    } catch (err) {
      fail(err);
    }
  });
}
