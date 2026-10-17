// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, POLL_INTERVALS } from '../src/config.js';
import { SENSOR_UNITS } from '../src/devices.js';
import { COMMAND_KINDS, COMMAND_TIMEOUTS } from '../src/hosts.js';
import { TRIGGERS, WIDGET_KEY } from '../src/monitor.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { REASONS } from '../src/ssh.js';
import { WIDGETS } from '../src/widgets.js';
import { action, createWorld, homeServer } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const { gladys: registered, app } = await createWorld({ connect: false });
await app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionValues = (field) => field.options.map((option) => option.value);
const field = (list, key) => list.find((entry) => entry.key === key);

test('identity: name, image, cover, local transport, network category', () => {
  assert.equal(manifest.name, 'SSH');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-ssh:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-ssh/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['network']);
});

test('Gladys 5.1.0 at least: widgets, scene triggers and actions', () => {
  const [major, minor] = manifest.gladys_version
    .match(/>=\s*(\d+)\.(\d+)/)
    .slice(1)
    .map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), handlerKeys('action:').sort());
});

test('every scene action has a handler, and its outputs are the declared ones', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(handlerKeys('sceneAction:').sort(), keysOf(manifest.scene_actions).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = await homeServer(world);
  await action(world, 'add_command', {
    host: 'Home server',
    name: 'Plex',
    command: 'systemctl is-active plex',
    kind: 'text',
  });
  const result = await world.fake.sceneAction('run_command', {
    device: device.external_id,
    command: 'Plex',
  });
  const [declared] = manifest.scene_actions;
  assert.equal(result.success, true);
  assert.deepEqual(Object.keys(result.data.outputs).sort(), keysOf(declared.outputs).sort());
  for (const output of declared.outputs) {
    assert.notEqual(output.type, 'boolean', output.key);
  }
  assert.ok(declared.timeout_seconds >= Math.max(...COMMAND_TIMEOUTS.map(Number)) + 15);
});

test('the scene triggers fired are declared, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = await homeServer(world);
  await action(world, 'add_command', {
    host: 'Home server',
    name: 'Fail',
    command: 'false',
    kind: 'action',
  });
  await world.fake.sceneAction('run_command', { device: device.external_id, command: 'Fail' });
  world.network.machines['192.0.2.10'].down = 'auth';
  await world.monitor.runCycle();
  delete world.network.machines['192.0.2.10'].down;
  await world.monitor.runCycle();
  for (const trigger of manifest.scene_triggers) {
    const event = world.fake.sceneEvents.find((entry) => entry.key === trigger.key);
    assert.ok(event, `${trigger.key} fired`);
    assert.deepEqual(
      Object.keys(event.data).sort(),
      [...new Set([...keysOf(trigger.fields), ...keysOf(trigger.variables)])].sort(),
      trigger.key,
    );
    assert.equal(event.data.device, device.external_id);
  }
  const unreachable = world.fake.sceneEvents.find((e) => e.key === TRIGGERS.UNREACHABLE);
  assert.ok(REASONS.includes(unreachable.data.reason));
});

test('every widget has its handlers, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widget:'), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widgetAction:'), [WIDGET_KEY]);
  assert.ok(manifest.widgets[0].action_timeout_seconds >= 100);
});

test('config_schema defaults and options are the ones of the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, entry.key);
    }
  }
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((entry) => entry.type !== 'section')
      .map((entry) => entry.key)
      .sort(),
  );
  assert.deepEqual(optionValues(field(manifest.config_schema, 'language')), LANGUAGES);
  assert.deepEqual(optionValues(field(manifest.config_schema, 'poll_interval')), POLL_INTERVALS);
  const commandFields = field(manifest.actions, 'add_command').fields;
  assert.deepEqual(optionValues(field(commandFields, 'kind')), COMMAND_KINDS);
  assert.deepEqual(optionValues(field(commandFields, 'unit')), SENSOR_UNITS);
  assert.deepEqual(optionValues(field(commandFields, 'timeout')), COMMAND_TIMEOUTS);
});

test('secrets: the key fields are secret, never logged as defaults', () => {
  for (const key of ['private_key', 'private_key_passphrase']) {
    const entry = field(manifest.config_schema, key);
    assert.equal(entry.type, 'secret');
    assert.equal(entry.default, undefined);
  }
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare the devices source and no static options', () => {
  const dynamic = allFields.filter((entry) => entry.source !== undefined);
  assert.ok(dynamic.length >= 4);
  for (const entry of dynamic) {
    assert.equal(entry.source, 'devices');
    assert.equal(entry.options, undefined, entry.key);
  }
});

test('number fields have integer bounds (the form has no step)', () => {
  for (const entry of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (entry[key] !== undefined) {
        assert.ok(Number.isInteger(entry[key]), `${entry.key}.${key}`);
      }
    }
  }
});

test('actions: no secret field, no default (the core applies none to actions)', () => {
  // GladysAssistant/Gladys#3154 and #3155.
  for (const entry of manifest.actions) {
    for (const item of entry.fields ?? []) {
      assert.notEqual(item.type, 'secret', `${entry.key}.${item.key}`);
      assert.equal(item.default, undefined, `${entry.key}.${item.key}`);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
