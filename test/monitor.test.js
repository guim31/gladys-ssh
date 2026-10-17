// -----------------------------------------------------------------------------
// The monitor against simulated machines: hosts added and read, host keys
// learned and checked, triggers, custom sensors, the read cycle of the
// container (no onPoll), persistence across a restart.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_COMMAND } from '../src/metrics.js';
import { TRIGGERS } from '../src/monitor.js';
import {
  HOME_SERVER,
  KEY,
  SERVER,
  action,
  create,
  createNetwork,
  createWorld,
  discovered,
  featureId,
  homeServer,
  last,
} from './helpers/world.js';

const message = (ack, lang = 'en') => ack.data?.message?.[lang] ?? ack.data?.message;
const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);

async function cycle(world, ms = 5 * 60_000) {
  world.clock.advance(ms);
  await world.monitor.runCycle();
}

test('adding a host connects once, remembers its host key and proposes its device', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await action(world, 'add_host', { ...HOME_SERVER, port: '' });
  assert.equal(ack.success, true);
  assert.match(message(ack), /Home server saved\./);
  assert.match(message(ack), new RegExp(`Host key ${SERVER.fingerprint} remembered`));
  assert.match(message(ack), /Discover tab/);
  assert.match(message(ack, 'fr'), /Clé d'hôte SHA256:/);
  assert.equal(world.monitor.hosts.get('home-server').fingerprint, SERVER.fingerprint);
  const device = discovered(world, 'Home server');
  assert.equal(device.should_poll, false);
  assert.deepEqual(device.params, [
    { name: 'ADDRESS', value: '192.0.2.10' },
    { name: 'PORT', value: '22' },
    { name: 'USERNAME', value: 'gladys' },
  ]);
  assert.deepEqual(
    device.features.map((feature) => feature.external_id.split(':').pop()),
    ['reachable', 'load', 'memory', 'disk', 'uptime'],
  );
  // French names by default.
  assert.equal(device.features[0].name, 'Joignable');
});

test('a refused key is explained, with the way to authorize the public key', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await action(world, 'add_host', { ...HOME_SERVER, username: 'root' });
  assert.match(message(ack), /Connection failed: authentication refused/);
  assert.match(message(ack), /Show the public key/);
  assert.match(message(ack, 'de'), /Anmeldung abgelehnt/);
  // Saved anyway: the user authorizes the key, then the cycles connect.
  assert.ok(world.monitor.hosts.has('home-server'));
  assert.equal(world.monitor.hosts.get('home-server').fingerprint, null);
});

test('a password is used, kept when the field is left empty, and never shown back', async (t) => {
  const network = createNetwork({
    '192.0.2.20': { ...SERVER, users: { admin: { password: 'p4ss word ' } } },
  });
  const world = await createWorld({ network });
  t.after(() => world.app.stop());
  const nas = { name: 'NAS', address: '192.0.2.20', username: 'admin' };
  const first = await action(world, 'add_host', { ...nas, password: 'p4ss word ' });
  assert.match(message(first), /Connected as admin/);
  const again = await action(world, 'add_host', { ...nas, password: '' });
  assert.match(message(again), /Connected as admin, host key checked/);
  assert.equal(world.network.sessions.at(-1).target.password, 'p4ss word ');
  const list = await action(world, 'list_hosts');
  assert.doesNotMatch(JSON.stringify([first, again, list, world.fake.discoveredDevices]), /p4ss/);
});

test('a created host is read by the container cycle, without onPoll', async (t) => {
  const world = await createWorld({
    network: createNetwork({ '192.0.2.10': SERVER, '192.0.2.11': SERVER }),
  });
  t.after(() => world.app.stop());
  const device = await homeServer(world);
  await action(world, 'add_host', { name: 'Other', address: '192.0.2.11', username: 'gladys' });
  // Created: read at once, every state published (Alpine fixture).
  assert.equal(last(world, device, 'reachable'), 1);
  assert.equal(last(world, device, 'load'), 1.77);
  assert.equal(last(world, device, 'memory'), 64.3);
  assert.equal(last(world, device, 'disk'), 81.6);
  assert.equal(last(world, device, 'uptime'), 8.95);
  world.network.sessions.length = 0;
  await cycle(world);
  // Only the created host is read; one session with the standard command.
  assert.deepEqual(
    world.network.sessions.map((s) => [s.target.address, s.commands]),
    [['192.0.2.10', [STANDARD_COMMAND]]],
  );
});

test('a host lost and back: one trigger each, after a second try', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = await homeServer(world);
  world.network.machines['192.0.2.10'].down = 'refused';
  world.network.sessions.length = 0;
  await cycle(world);
  assert.equal(world.network.sessions.length, 2, 'tried again before declaring it lost');
  await cycle(world);
  assert.equal(last(world, device, 'reachable'), 0);
  assert.deepEqual(
    events(world, TRIGGERS.UNREACHABLE).map((event) => event.data),
    [{ device: device.external_id, name: 'Home server', address: '192.0.2.10', reason: 'refused' }],
  );
  delete world.network.machines['192.0.2.10'].down;
  await cycle(world);
  assert.equal(last(world, device, 'reachable'), 1);
  assert.deepEqual(
    events(world, TRIGGERS.BACK).map((event) => event.data),
    [{ device: device.external_id, name: 'Home server', address: '192.0.2.10', down_minutes: 10 }],
  );
});

test('one lost packet does not fire "unreachable"', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = await homeServer(world);
  world.network.machines['192.0.2.10'].failures = 1;
  await cycle(world);
  assert.equal(last(world, device, 'reachable'), 1);
  assert.deepEqual(events(world, TRIGGERS.UNREACHABLE), []);
});

test('a changed host key is refused at once, until the user accepts it', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = await homeServer(world);
  world.network.machines['192.0.2.10'].fingerprint = 'SHA256:reinstalled';
  world.network.sessions.length = 0;
  await cycle(world);
  assert.equal(world.network.sessions.length, 1, 'no second try for a host key');
  assert.equal(last(world, device, 'reachable'), 0);
  assert.equal(events(world, TRIGGERS.UNREACHABLE)[0].data.reason, 'host_key_changed');
  const saved = await action(world, 'add_host', HOME_SERVER);
  assert.match(message(saved), /host key changed/);
  assert.match(message(saved), /Accept a new host key/);

  const forget = await action(world, 'forget_host_key', { host: 'home SERVER' });
  assert.match(message(forget), /Host key of Home server forgotten/);
  await cycle(world);
  assert.equal(last(world, device, 'reachable'), 1);
  assert.equal(world.monitor.hosts.get('home-server').fingerprint, 'SHA256:reinstalled');
});

test('another address means another machine: its host key is learned again', async (t) => {
  const world = await createWorld({
    network: createNetwork({
      '192.0.2.10': SERVER,
      '192.0.2.12': { ...SERVER, fingerprint: 'SHA256:other' },
    }),
  });
  t.after(() => world.app.stop());
  await homeServer(world);
  const ack = await action(world, 'add_host', { ...HOME_SERVER, address: '192.0.2.12' });
  assert.match(message(ack), /Host key SHA256:other remembered/);
});

test('custom sensors: numbers (decimal comma), texts, and a failure fired once', async (t) => {
  const world = await createWorld({ config: { standard_metrics: false } });
  t.after(() => world.app.stop());
  await action(world, 'add_host', HOME_SERVER);
  const temp = await action(world, 'add_command', {
    host: 'Home server',
    name: 'CPU',
    command: 'vcgencmd measure_temp',
    kind: 'number',
    unit: 'celsius',
  });
  assert.match(message(temp), /"CPU" saved on Home server\.\nFirst read: 47\.8 \(celsius\)\./);
  await action(world, 'add_command', {
    host: 'Home server',
    name: 'Plex',
    command: 'systemctl is-active plex',
    kind: 'text',
  });
  const device = await create(world, 'Home server');
  assert.deepEqual(
    device.features.map((feature) => [feature.name, feature.category, feature.unit]),
    [
      ['Joignable', 'input', undefined],
      ['CPU', 'device-temperature-sensor', 'celsius'],
      ['Plex', 'text', undefined],
    ],
  );
  assert.equal(last(world, device, 'cmd-cpu'), 47.8);
  assert.equal(last(world, device, 'cmd-plex'), 'active');

  const commands = world.network.machines['192.0.2.10'].commands;
  commands['vcgencmd measure_temp'] = { code: 1, stdout: '', stderr: 'VCHI init failed' };
  await cycle(world);
  await cycle(world);
  assert.deepEqual(
    events(world, TRIGGERS.COMMAND_FAILED).map((event) => event.data),
    [
      {
        device: device.external_id,
        name: 'Home server',
        command: 'CPU',
        exit_code: 1,
        output: 'VCHI init failed',
      },
    ],
  );
  // The last good value stays; the text keeps being read.
  assert.equal(last(world, device, 'cmd-cpu'), 47.8);
  commands['systemctl is-active plex'] = { code: 0, stdout: 'inactive\n' };
  commands['vcgencmd measure_temp'] = { code: 0, stdout: "temp=51.0'C" };
  await cycle(world);
  assert.equal(last(world, device, 'cmd-plex'), 'inactive');
  assert.equal(last(world, device, 'cmd-cpu'), 51);
});

test('a sensor added to a created device asks for an update in the Discover tab', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await homeServer(world);
  const ack = await action(world, 'add_command', {
    host: 'Home server',
    name: 'Temp',
    command: 'cat /sys/class/thermal/thermal_zone0/temp',
    kind: 'number',
  });
  assert.match(message(ack), /First read: 48250\./);
  assert.match(message(ack), /"Update"/);
  const action2 = await action(world, 'add_command', {
    host: 'Home server',
    name: 'Restart Plex',
    command: 'sudo systemctl restart plex',
    kind: 'action',
    button: true,
  });
  // An action is never run on save, and is no feature.
  assert.doesNotMatch(message(action2), /First read|Update/);
  assert.ok(
    !world.network.sessions.some((s) => s.commands.includes('sudo systemctl restart plex')),
  );
  assert.equal(featureId(discovered(world, 'Home server'), 'cmd-restart-plex'), undefined);
});

test('configuration mistakes are answered in every language, not thrown', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const cases = [
    ['add_host', { name: '', address: '192.0.2.10', username: 'a' }, /Give the host a name/],
    ['add_host', { name: 'A', address: 'not an address', username: 'a' }, /is not an IP address/],
    [
      'add_host',
      { name: 'A', address: '192.0.2.10', port: 70000, username: 'a' },
      /not a TCP port/,
    ],
    ['add_host', { name: 'A', address: '192.0.2.10', username: 'a b' }, /user name/],
    ['remove_host', { host: 'Nope' }, /No host is named "Nope"/],
    ['add_command', { host: 'Nope', name: 'x', command: 'x', kind: 'text' }, /No host/],
  ];
  for (const [key, fields, expected] of cases) {
    const ack = await action(world, key, fields);
    assert.equal(ack.success, true, key);
    assert.match(message(ack), expected);
    assert.equal(Object.keys(ack.data.message).length, 4);
  }
  await action(world, 'add_host', HOME_SERVER);
  const more = [
    [{ name: 'Charge (1 min)', command: 'x', kind: 'number' }, /standard feature/],
    [{ name: 'X', command: '', kind: 'number' }, /Enter the command/],
    [{ name: 'X', command: 'x', kind: 'shell' }, /Choose what the command is/],
    [{ name: 'X', command: 'x'.repeat(1001), kind: 'text' }, /too long/],
  ];
  for (const [fields, expected] of more) {
    const ack = await action(world, 'add_command', { host: 'Home server', ...fields });
    assert.match(message(ack), expected);
  }
  const removed = await action(world, 'remove_command', { host: 'Home server', name: 'Nope' });
  assert.match(message(removed), /Home server has no command named "Nope"/);
});

test('removing a command and a host', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_host', HOME_SERVER);
  await action(world, 'add_command', {
    host: 'Home server',
    name: 'V',
    command: 'uname -r',
    kind: 'text',
  });
  assert.ok(featureId(discovered(world, 'Home server'), 'cmd-v'));
  await action(world, 'remove_command', { host: 'Home server', name: 'v' });
  assert.equal(featureId(discovered(world, 'Home server'), 'cmd-v'), undefined);
  const ack = await action(world, 'remove_host', { host: 'Home server' });
  assert.match(message(ack), /Home server removed/);
  assert.deepEqual(world.fake.discoveredDevices, []);
});

test('the public key action shows the line to authorize, never the private key', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await action(world, 'show_public_key');
  assert.ok(message(ack).includes(KEY.publicLine));
  assert.ok(message(ack).includes(`no-pty ${KEY.publicLine}`));
  assert.ok(!JSON.stringify(ack).includes(KEY.privateKey));
});

test('an unreadable private key in the configuration is shown in the status', async (t) => {
  const world = await createWorld({
    config: { private_key: 'garbage' },
    loadKey: async () => {
      throw Object.assign(new Error('Unreadable private key'), { code: 'keyInvalid' });
    },
  });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(
    world.fake.connectionStatus.message.en,
    /private key of the configuration is unreadable/,
  );
  const ack = await action(world, 'show_public_key');
  assert.match(message(ack), /unreadable/);
});

test('a restart neither forgets the host key nor fires "unreachable" again', async (t) => {
  const first = await createWorld();
  const device = await homeServer(first);
  first.network.machines['192.0.2.10'].down = 'timeout';
  await cycle(first);
  await first.app.stop();
  assert.equal(events(first, TRIGGERS.UNREACHABLE).length, 1);

  const second = await createWorld({
    network: first.network,
    dataDir: first.dataDir,
    devices: [device],
  });
  t.after(() => second.app.stop());
  await second.monitor.running;
  assert.equal(second.monitor.hosts.get('home-server').fingerprint, SERVER.fingerprint);
  assert.deepEqual(events(second, TRIGGERS.UNREACHABLE), []);
  delete second.network.machines['192.0.2.10'].down;
  await cycle(second);
  assert.equal(events(second, TRIGGERS.BACK).length, 1);
});

test('a device created later gets every state again, and the widget a refresh', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await action(world, 'add_host', HOME_SERVER);
  const device = discovered(world, 'Home server');
  // Read once before the creation (the states would be dropped by the core).
  await world.monitor.readHost(world.monitor.hosts.get('home-server'));
  const before = world.fake.states.length;
  await world.fake.deviceCreated(device);
  assert.ok(world.fake.states.length >= before + 5, 'all states published again');
  assert.ok(world.fake.widgetRefreshes.length >= 1);
});
