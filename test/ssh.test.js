// -----------------------------------------------------------------------------
// The real SSH client (src/ssh.js) against an in-process ssh2 server listening
// on 127.0.0.1 (loopback only, no network): key and password authentication,
// host key trust on first use and refusal on change, timeouts, output caps,
// and the error codes the triggers and messages rely on.
// -----------------------------------------------------------------------------

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import ssh2 from 'ssh2';
import { fingerprint, parsePrivateKey } from '../src/keys.js';
import { runSession } from '../src/ssh.js';

const { Server, utils } = ssh2;

const hostKey = utils.generateKeyPairSync('ed25519');
const otherHostKey = utils.generateKeyPairSync('ed25519');
const client = parsePrivateKey(utils.generateKeyPairSync('ed25519').private);
const stranger = parsePrivateKey(utils.generateKeyPairSync('ed25519').private);
const allowed = utils.parseKey(client.publicLine);
const HOST_FP = fingerprint(utils.parseKey(hostKey.public).getPublicSSH());

const signals = [];

// Commands the test server knows.
function execute(command, stream) {
  if (command === 'echo hello') {
    stream.write('hello\n');
    stream.exit(0);
    stream.end();
  } else if (command === 'fail') {
    stream.stderr.write('boom\n');
    stream.exit(3);
    stream.end();
  } else if (command === 'big') {
    stream.write(Buffer.alloc(100_000, 'x'));
    stream.exit(0);
    stream.end();
  } else if (command === 'sleep') {
    // Never ends by itself; stops on the KILL signal.
  } else {
    stream.stderr.write(`sh: ${command}: not found\n`);
    stream.exit(127);
    stream.end();
  }
}

function startServer(key) {
  const server = new Server({ hostKeys: [key.private] }, (conn) => {
    conn.on('authentication', (ctx) => {
      if (ctx.username !== 'gladys') {
        return ctx.reject();
      }
      if (ctx.method === 'password') {
        return ctx.password === 'secret' ? ctx.accept() : ctx.reject();
      }
      if (ctx.method === 'publickey') {
        const known = allowed.getPublicSSH();
        const same =
          ctx.key.algo === allowed.type &&
          ctx.key.data.length === known.length &&
          timingSafeEqual(ctx.key.data, known);
        if (!same) {
          return ctx.reject();
        }
        if (ctx.signature) {
          return allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true
            ? ctx.accept()
            : ctx.reject();
        }
        return ctx.accept();
      }
      return ctx.reject(['publickey', 'password']);
    });
    conn.on('ready', () => {
      conn.on('session', (accept) => {
        const session = accept();
        let current = null;
        session.on('exec', (acceptExec, _reject, info) => {
          current = acceptExec();
          execute(info.command, current);
        });
        session.on('signal', (_accept, _reject, info) => {
          signals.push(info.name);
          current?.exit('KILL');
          current?.end();
        });
      });
    });
    conn.on('error', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let server;
let other;
const target = (port, extra = {}) => ({ address: '127.0.0.1', port, username: 'gladys', ...extra });

before(async () => {
  server = await startServer(hostKey);
  other = await startServer(otherHostKey);
});
after(() => {
  server.close();
  other.close();
});

test('key authentication, host key learned on first contact, commands in order', async () => {
  const { port } = server.address();
  const result = await runSession(
    target(port),
    [
      { command: 'echo hello', timeoutMs: 5000 },
      { command: 'fail', timeoutMs: 5000 },
      { command: 'nope', timeoutMs: 5000 },
    ],
    { key: client, knownFingerprint: null },
  );
  assert.equal(result.fingerprint, HOST_FP);
  assert.deepEqual(
    result.results.map((r) => [r.code, r.stdout, r.stderr, r.timedOut]),
    [
      [0, 'hello\n', '', false],
      [3, '', 'boom\n', false],
      [127, '', 'sh: nope: not found\n', false],
    ],
  );
});

test('the known host key is accepted, another one refused before authentication', async () => {
  const { port } = server.address();
  const ok = await runSession(target(port), [], { key: client, knownFingerprint: HOST_FP });
  assert.equal(ok.fingerprint, HOST_FP);
  await assert.rejects(
    runSession(target(other.address().port), [], { key: client, knownFingerprint: HOST_FP }),
    (err) => err.code === 'host_key_changed' && err.expected === HOST_FP,
  );
});

test('a password works when the key is refused; a wrong one is "auth"', async () => {
  const { port } = server.address();
  const ok = await runSession(
    target(port, { password: 'secret' }),
    [{ command: 'echo hello', timeoutMs: 5000 }],
    { key: stranger, knownFingerprint: HOST_FP },
  );
  assert.equal(ok.results[0].stdout, 'hello\n');
  await assert.rejects(
    runSession(target(port, { password: 'wrong' }), [], {
      key: stranger,
      knownFingerprint: HOST_FP,
    }),
    (err) => err.code === 'auth',
  );
  await assert.rejects(
    runSession(target(port), [], { key: stranger, knownFingerprint: HOST_FP }),
    (err) => err.code === 'auth',
  );
});

test('a command over its time limit is killed and reported', async () => {
  const { port } = server.address();
  const started = Date.now();
  const result = await runSession(
    target(port),
    [
      { command: 'sleep', timeoutMs: 300 },
      { command: 'echo hello', timeoutMs: 5000 },
    ],
    { key: client, knownFingerprint: HOST_FP },
  );
  assert.ok(Date.now() - started < 3000);
  assert.equal(result.results[0].timedOut, true);
  assert.equal(result.results[0].code, null);
  assert.ok(signals.includes('KILL'));
  assert.equal(result.results[1].stdout, 'hello\n', 'the session goes on');
});

test('the output is capped', async () => {
  const { port } = server.address();
  const result = await runSession(
    target(port),
    [{ command: 'big', timeoutMs: 5000, maxBytes: 1000 }],
    { key: client, knownFingerprint: HOST_FP },
  );
  assert.equal(result.results[0].stdout.length, 1000);
  assert.equal(result.results[0].truncated, true);
});

test('a closed port is "refused"', async () => {
  const probe = await startServer(hostKey);
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  await assert.rejects(
    runSession(target(port), [], { key: client, knownFingerprint: null }),
    (err) => err.code === 'refused',
  );
});

test('a connection closed during a command (a reboot) resolves, never crashes', async () => {
  const dropper = new Server({ hostKeys: [hostKey.private] }, (conn) => {
    conn.on('authentication', (ctx) => ctx.accept());
    conn.on('ready', () => {
      conn.on('session', (accept) => {
        accept().on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec();
          if (info.command === 'reboot') {
            setTimeout(() => conn.end(), 50);
          } else {
            stream.write('ok\n');
            stream.exit(0);
            stream.end();
          }
        });
      });
    });
    conn.on('error', () => {});
  });
  await new Promise((resolve) => dropper.listen(0, '127.0.0.1', resolve));
  const result = await runSession(
    target(dropper.address().port),
    [
      { command: 'echo ok', timeoutMs: 5000 },
      { command: 'reboot', timeoutMs: 5000 },
      { command: 'echo ok', timeoutMs: 5000 },
    ],
    { key: client, knownFingerprint: HOST_FP },
  );
  dropper.close();
  assert.deepEqual(
    result.results.map((r) => [r.code, Boolean(r.disconnected)]),
    [
      [0, false],
      [null, true],
      [null, true],
    ],
  );
});

test('a server that never answers the channel hits the session deadline', async () => {
  const mute = new Server({ hostKeys: [hostKey.private] }, (conn) => {
    conn.on('authentication', (ctx) => ctx.accept());
    conn.on('ready', () => conn.on('session', () => {}));
    conn.on('error', () => {});
  });
  await new Promise((resolve) => mute.listen(0, '127.0.0.1', resolve));
  const started = Date.now();
  await assert.rejects(
    runSession(target(mute.address().port), [{ command: 'x', timeoutMs: 100 }], {
      key: client,
      knownFingerprint: HOST_FP,
      connectTimeoutMs: 1000,
    }),
    (err) => err.code === 'timeout',
  );
  assert.ok(Date.now() - started < 10_000);
  mute.close();
});
