// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, simulated SSH machines (which
// address answers, with which host key, what each command prints), a manual
// clock, a temporary /data, and the integration wired on top through
// registerHandlers. Nothing touches the network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { STANDARD_COMMAND } from '../../src/metrics.js';
import { SshError } from '../../src/ssh.js';
import { Store } from '../../src/store.js';

process.env.LOG_LEVEL ??= 'silent';

/** Real output of STANDARD_COMMAND (linuxserver/openssh-server, Alpine/BusyBox). */
export const STANDARD_OUTPUT = readFileSync(
  new URL('../fixtures/metrics/alpine-busybox.txt', import.meta.url),
  'utf8',
);

export const KEY = {
  privateKey: 'not-a-real-key',
  publicLine: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleExampleExampleExampleExample gladys-ssh',
  fingerprint: 'SHA256:clientclientclientclientclientclientclient',
  source: 'generated',
};

/**
 * Simulated machines: `machines[address] = { fingerprint, users, down, commands }`.
 * `users[name] = { key: true }` or `{ password: '…' }`; `down`: an SshError code;
 * `failures`: that many sessions time out first;
 * `commands[text] = { code, stdout, stderr, timedOut }` (STANDARD_COMMAND
 * answers STANDARD_OUTPUT unless overridden).
 */
export function createNetwork(machines = {}) {
  const network = {
    machines: structuredClone(machines),
    sessions: [],
    async session(target, commands, { key, knownFingerprint }) {
      network.sessions.push({ target: { ...target }, commands: commands.map((c) => c.command) });
      const machine = network.machines[target.address];
      if (!machine) {
        throw new SshError('timeout', 'No answer');
      }
      if (machine.failures > 0) {
        machine.failures -= 1;
        throw new SshError('timeout', 'No answer');
      }
      if (machine.down) {
        throw new SshError(machine.down, machine.down);
      }
      if (knownFingerprint && knownFingerprint !== machine.fingerprint) {
        throw new SshError('host_key_changed', 'The host key changed');
      }
      const user = machine.users?.[target.username];
      const keyOk = user?.key && key?.privateKey;
      const passwordOk = user?.password !== undefined && user.password === target.password;
      if (!keyOk && !passwordOk) {
        throw new SshError('auth', 'Authentication failed');
      }
      const results = commands.map(({ command }) => {
        const answer =
          machine.commands?.[command] ??
          (command === STANDARD_COMMAND ? { code: 0, stdout: STANDARD_OUTPUT } : null);
        return answer
          ? { stderr: '', stdout: '', timedOut: false, ...answer }
          : { code: 127, stdout: '', stderr: `sh: ${command}: not found`, timedOut: false };
      });
      return { fingerprint: machine.fingerprint, results };
    },
  };
  return network;
}

export const SERVER = {
  fingerprint: 'SHA256:serverserverserverserverserverserverserver',
  users: { gladys: { key: true } },
  commands: {
    'cat /sys/class/thermal/thermal_zone0/temp': { code: 0, stdout: '48250\n' },
    'vcgencmd measure_temp': { code: 0, stdout: "temp=47,8'C\n" },
    'systemctl is-active plex': { code: 0, stdout: 'active\n' },
    'sudo systemctl restart plex': { code: 0, stdout: '' },
    false: { code: 1, stdout: '', stderr: 'failed' },
  },
};

/** A manual clock; `sleep` moves it forward instead of waiting. */
export function createClock(start = 1_700_000_000_000) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
    async sleep(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {object} [options.network] from createNetwork
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {object} [options.saved] content of /data/state.json before the start
 * @param {Function} [options.loadKey] replaces the client key loader
 */
export async function createWorld({
  config = {},
  network = createNetwork({ '192.0.2.10': SERVER }),
  devices = [],
  saved,
  connect = true,
  loadKey = async () => KEY,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-ssh-')),
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const store = new Store(dataDir);
  if (saved) {
    await store.save(saved);
    await store.flush();
  }
  const clock = createClock();
  const app = registerHandlers(gladys, {
    store,
    session: network.session,
    loadKey,
    timers: false,
    now: clock.now,
    sleep: clock.sleep,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await app.monitor.running;
  }
  return { gladys, fake: gladys.fake, app, monitor: app.monitor, network, clock, store, dataDir };
}

export const HOME_SERVER = { name: 'Home server', address: '192.0.2.10', username: 'gladys' };

/** Run a configuration action; resolves with the ack. */
export const action = (world, key, fields) => world.fake.action(key, fields);

/** The device published for a host name, from the last discovery list. */
export const discovered = (world, name) =>
  world.fake.discoveredDevices.find((device) => device.name === name);

/** Create the device of a host in Gladys, as the user would. */
export async function create(world, name) {
  const device = discovered(world, name);
  if (!device) {
    throw new Error(`${name} is not in the discovered devices`);
  }
  await world.fake.deviceCreated(device);
  return device;
}

/** Adds the home server and creates its device. */
export async function homeServer(world, fields = {}) {
  await action(world, 'add_host', { ...HOME_SERVER, ...fields });
  return create(world, HOME_SERVER.name);
}

/** External id of one feature of a device. */
export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`))?.external_id;

/** Last value published for a feature key of a device (state or text). */
export function last(world, device, key) {
  return world.fake.lastState(featureId(device, key));
}

/**
 * Capture the integration's log lines at `level` and above (LOG_LEVEL is read
 * at every call). Returns the lines as `{ level, text }`.
 */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const match = /^\[[^\]]+\] \[(\w+)\]/.exec(text);
    lines.push({ level: match ? match[1].toLowerCase() : 'raw', text });
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
