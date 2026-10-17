// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the monitor, so index.js stays a few lines and the tests drive
// the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { Monitor } from './monitor.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { INIT_FAILED } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'ssh-app' });

// A configuration action displays what it resolves, in the user's language,
// while a thrown error shows a single string: the mistakes of the user (an
// invalid address, an unknown host) are answered, not thrown.
const answered =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err.messages) {
        return err.messages;
      }
      throw err;
    }
  };

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, session, loadKey, timers, now, sleep, timings
 */
export function registerHandlers(gladys, options = {}) {
  const monitor = new Monitor({
    gladys,
    store: options.store ?? new Store(),
    session: options.session,
    loadKey: options.loadKey,
    timers: options.timers ?? true,
    now: options.now,
    sleep: options.sleep,
    timings: options.timings,
  });

  // Resolved once the monitor has started; every handler waits for it, so a
  // command arriving during the start is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): publish everything again.
        await monitor.resync(config);
        return;
      }
      started = true;
      await monitor.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => monitor.publishDiscovered()));

  // Devices are published with should_poll: false (read by the monitor's own
  // timer); this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady((device) => monitor.readHost(monitor.hostOfDevice(device.external_id))));

  gladys.onDeviceCreated(whenReady((device) => monitor.onDeviceCreated(device)));

  gladys.onConfigUpdated(whenReady((newConfig) => monitor.reconfigure(normalizeConfig(newConfig))));

  const actions = {
    add_host: (fields) => monitor.addHost(fields),
    remove_host: (fields) => monitor.removeHost(fields),
    add_command: (fields) => monitor.addCommand(fields),
    remove_command: (fields) => monitor.removeCommand(fields),
    forget_host_key: (fields) => monitor.forgetHostKey(fields),
    show_public_key: () => monitor.showPublicKey(),
    list_hosts: () => monitor.listHosts(),
  };
  for (const [key, handler] of Object.entries(actions)) {
    gladys.onAction(key, whenReady(answered(handler)));
  }

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(monitor, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(monitor, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(monitor, { actionKey, params, ...context }),
      ),
    );
  }

  return {
    monitor,
    ready,
    actions: Object.keys(actions),
    stop: () => monitor.stop(),
  };
}
