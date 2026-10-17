// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// inputs: hosts with the standard figures on and off, and custom sensors of
// every kind and unit, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { SENSOR_UNITS } from '../src/devices.js';
import { action, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const HOSTS = [
  { name: 'Home server', address: '192.0.2.10', username: 'gladys' },
  { name: 'NAS', address: 'nas.example.org', port: 2222, username: 'admin', password: 'x' },
  { name: 'Raspberry Pi', address: '2001:db8::10', username: 'pi' },
];

// Every unit on the first host, a text sensor and an action everywhere.
const COMMANDS = [
  ...SENSOR_UNITS.map((unit, index) => ({
    host: 'Home server',
    name: `Sensor ${index + 1}`,
    command: 'echo 1',
    kind: 'number',
    unit,
  })),
  ...HOSTS.flatMap(({ name }) => [
    { host: name, name: 'Version', command: 'uname -r', kind: 'text' },
    { host: name, name: 'Count', command: 'echo 3', kind: 'number' },
    { host: name, name: 'Reboot', command: 'sudo reboot', kind: 'action', button: true },
  ]),
];

for (const language of LANGUAGES) {
  for (const standardMetrics of [true, false]) {
    test(`every discovered device follows the Gladys rules (${language}, standard figures ${standardMetrics ? 'on' : 'off'})`, async (t) => {
      const world = await createWorld({
        config: { language, standard_metrics: standardMetrics },
      });
      t.after(() => world.app.stop());
      for (const fields of HOSTS) {
        await action(world, 'add_host', fields);
      }
      for (const fields of COMMANDS) {
        const ack = await action(world, 'add_command', fields);
        assert.equal(ack.success, true, JSON.stringify(ack));
      }
      const devices = world.fake.discoveredDevices;
      assert.equal(devices.length, HOSTS.length);

      const deviceIds = new Set();
      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(allowed.includes(feature.unit), `${at}: ${feature.unit} not allowed`);
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
      const home = devices.find((device) => device.name === 'Home server');
      // reachable + 4 standard + every unit + text + number (the action is no feature).
      assert.equal(home.features.length, 1 + (standardMetrics ? 4 : 0) + SENSOR_UNITS.length + 2);
    });
  }
}
