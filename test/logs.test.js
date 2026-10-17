// -----------------------------------------------------------------------------
// What the integration writes to `docker logs`: at info, only the lifecycle
// (a host lost or back, a command run by the user), never one line per read
// cycle; a failure repeated at every cycle is logged once, plus one line when
// it is over. Never a password nor a private key.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOME_SERVER, action, captureLogs, createWorld, homeServer } from './helpers/world.js';

async function cycles(world, count) {
  for (let i = 0; i < count; i += 1) {
    world.clock.advance(5 * 60_000);
    await world.monitor.runCycle();
  }
}

const texts = (lines) => lines.map((line) => line.text.replace(/^\[[^\]]+\] \[\w+\] /, ''));

test('a normal read cycle writes nothing at info', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await homeServer(world);
  const lines = captureLogs(t, 'info');
  await cycles(world, 5);
  assert.deepEqual(lines, []);
});

test('LOG_LEVEL=debug shows the read cycles', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await homeServer(world);
  const lines = captureLogs(t, 'debug');
  await cycles(world, 2);
  assert.equal(lines.filter((line) => /Read cycle: 1 host/.test(line.text)).length, 2);
});

test('a host lost and back is one info line each', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await homeServer(world);
  const lines = captureLogs(t, 'info');
  world.network.machines['192.0.2.10'].down = 'timeout';
  await cycles(world, 4);
  delete world.network.machines['192.0.2.10'].down;
  await cycles(world, 3);
  assert.deepEqual(texts(lines), [
    '[ssh] Home server is unreachable: timeout',
    '[ssh] Home server is reachable again',
  ]);
});

test('states refused at every cycle: one warning, then one line at recovery', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await homeServer(world);
  const lines = captureLogs(t, 'info');
  const publish = t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new Error('Gladys unreachable');
  });
  await cycles(world, 4);
  assert.ok(publish.mock.callCount() >= 4);
  assert.deepEqual(texts(lines), ['[ssh] Publishing the states failed: Gladys unreachable']);
  publish.mock.restore();
  await cycles(world, 2);
  assert.equal(lines.length, 2);
  assert.match(lines[1].text, /\[INFO\].*Publishing the states works again/);
});

test('no password, private key nor command output in the logs', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const lines = captureLogs(t, 'debug');
  world.network.machines['192.0.2.10'].users.gladys.password = 'S3cret!';
  await homeServer(world, { password: 'S3cret!' });
  await action(world, 'add_command', {
    host: 'Home server',
    name: 'Plex',
    command: 'systemctl is-active plex',
    kind: 'text',
    button: true,
  });
  await world.fake.sceneAction('run_command', {
    device: world.fake.discoveredDevices[0].external_id,
    command: 'Plex',
  });
  await action(world, 'show_public_key');
  await action(world, 'add_host', { ...HOME_SERVER, username: 'nobody' });
  const all = lines.map((line) => line.text).join('\n');
  assert.doesNotMatch(all, /S3cret|not-a-real-key|PRIVATE KEY/);
  assert.match(all, /Running "Plex" on Home server \(scene\)/);
});
