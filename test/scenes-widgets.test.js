// -----------------------------------------------------------------------------
// The scene action and the widget: only declared commands ever run, whatever a
// scene or a widget request sends; results, failures and the content budget.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { TRIGGERS, WIDGET_KEY } from '../src/monitor.js';
import { formatUptime } from '../src/widgets.js';
import { action, createWorld, homeServer } from './helpers/world.js';

async function worldWithCommands(t) {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = await homeServer(world);
  const commands = [
    { name: 'Restart Plex', command: 'sudo systemctl restart plex', kind: 'action', button: true },
    { name: 'Fail', command: 'false', kind: 'action', button: true },
    { name: 'Plex', command: 'systemctl is-active plex', kind: 'text', button: true },
    { name: 'Temp', command: 'cat /sys/class/thermal/thermal_zone0/temp', kind: 'number' },
    { name: 'A4', command: 'true', kind: 'action', button: true },
    { name: 'A5', command: 'true', kind: 'action', button: true },
    { name: 'Hidden', command: 'true', kind: 'action' },
  ];
  for (const fields of commands) {
    await action(world, 'add_command', { host: 'Home server', ...fields });
  }
  return { world, device };
}

const ran = (world) => world.network.sessions.flatMap((session) => session.commands);

test('run_command runs the declared command and returns its result', async (t) => {
  const { world, device } = await worldWithCommands(t);
  const ok = await world.fake.sceneAction('run_command', {
    device: device.external_id,
    command: 'plex',
  });
  assert.deepEqual(ok.data.outputs, { success: 1, exit_code: 0, output: 'active' });
  const failed = await world.fake.sceneAction('run_command', {
    device: device.external_id,
    command: 'Fail',
  });
  assert.deepEqual(failed.data.outputs, { success: 0, exit_code: 1, output: 'failed' });
  assert.equal(world.fake.sceneEvents.at(-1).key, TRIGGERS.COMMAND_FAILED);
  assert.equal(world.fake.sceneEvents.at(-1).data.command, 'Fail');
});

test('a scene can only name a declared command: nothing is ever added to it', async (t) => {
  const { world, device } = await worldWithCommands(t);
  for (const command of ['Plex; reboot', 'Plex && rm -rf /', '$(reboot)', 'reboot']) {
    const ack = await world.fake.sceneAction('run_command', {
      device: device.external_id,
      command,
    });
    assert.equal(ack.success, false, command);
  }
  assert.ok(ran(world).every((command) => !/reboot|rm -rf/.test(command)));
  const other = await world.fake.sceneAction('run_command', {
    device: 'ext:other',
    command: 'Plex',
  });
  assert.equal(other.success, false);
});

test('an unreachable host: the scene gets exit code -1 and the reason', async (t) => {
  const { world, device } = await worldWithCommands(t);
  world.network.machines['192.0.2.10'].down = 'timeout';
  const ack = await world.fake.sceneAction('run_command', {
    device: device.external_id,
    command: 'Restart Plex',
  });
  assert.equal(ack.data.outputs.success, 0);
  assert.equal(ack.data.outputs.exit_code, -1);
  assert.match(ack.data.outputs.output, /pas de réponse/);
});

test('a command over its time limit counts as failed', async (t) => {
  const { world, device } = await worldWithCommands(t);
  world.network.machines['192.0.2.10'].commands['sudo systemctl restart plex'] = {
    code: null,
    timedOut: true,
  };
  const ack = await world.fake.sceneAction('run_command', {
    device: device.external_id,
    command: 'Restart Plex',
  });
  assert.equal(ack.data.outputs.success, 0);
  assert.equal(ack.data.outputs.exit_code, -1);
});

test('the widget: a valid status list and 4 buttons at most', async (t) => {
  const { world, device } = await worldWithCommands(t);
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await world.fake.widgetGet(WIDGET_KEY, {
      settings: { device: device.external_id },
      language,
    });
    const content = ack.data.content;
    assert.deepEqual(validateWidgetContent(content), [], language);
    const buttons = content.components.filter((component) => component.type === 'button');
    assert.equal(buttons.length, 4);
    assert.deepEqual(
      buttons.map((button) => button.action.key),
      ['run_1', 'run_2', 'run_3', 'run_4'],
    );
    const status = content.components.find((component) => component.type === 'status');
    assert.ok(status.items.length >= 6, 'state, 4 figures, sensors');
    assert.ok(status.items.every((item) => String(item.value).length <= 40));
  }
  const empty = await world.fake.widgetGet(WIDGET_KEY, { settings: { device: 'ext:gone' } });
  assert.equal(empty.data.content.components[0].type, 'text');
});

test('a widget button runs its command and answers in a toast', async (t) => {
  const { world, device } = await worldWithCommands(t);
  const content = (
    await world.fake.widgetGet(WIDGET_KEY, { settings: { device: device.external_id } })
  ).data.content;
  const [restart, fail] = content.components.filter((component) => component.type === 'button');
  const ok = await world.fake.widgetAction(WIDGET_KEY, restart.action.key, restart.action.params);
  assert.equal(ok.success, true);
  assert.match(JSON.stringify(ok.data), /Restart Plex: done/);
  const ko = await world.fake.widgetAction(WIDGET_KEY, fail.action.key, fail.action.params);
  assert.match(JSON.stringify(ko.data), /Fail: failed \(exit code 1\)/);
  // A forged request cannot reach an undeclared command, nor one without button.
  const forged = await world.fake.widgetAction(WIDGET_KEY, 'run_1', {
    host: 'home-server',
    command: 'hidden',
  });
  assert.match(JSON.stringify(forged.data), /no longer in the configuration/);
  assert.ok(!ran(world).includes('true'));
});

test('uptime reads as days and hours', () => {
  assert.equal(formatUptime(8.95, 'en'), '8 d 22 h');
  assert.equal(formatUptime(0.5, 'fr'), '12 h');
  assert.equal(formatUptime(3, 'de'), '3 T 0 Std.');
});
