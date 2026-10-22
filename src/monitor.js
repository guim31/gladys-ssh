// -----------------------------------------------------------------------------
// The monitor: the hosts and their commands, the SSH sessions, the states
// published to Gladys and the scene events. The SDK handlers, the scene actions
// and the widget all go through it (src/app.js wires it).
//
// Scheduling: devices are published with should_poll: false; the monitor reads
// every created host at the configured interval (minutes), a few at a time,
// one SSH session per host and cycle (standard figures and custom sensors in
// the same session). A failed connection is tried again once after a few
// seconds before the host is declared unreachable: one lost packet must not
// fire "Host unreachable".
//
// Security: only the commands declared in the configuration ever run. Scenes
// and widget buttons name a declared command; nothing they send is added to
// the command text.
//
// States: `publishChangedStates` sends only what changed, plus a heartbeat
// every 12 hours. Everything is published again when a device is created
// (a state sent before the creation is dropped by the core).
//
// Logs: at info, only the lifecycle (start, a host lost or back, one line per
// command run by the user or a scene). A failure that repeats at every cycle
// is logged once, then at debug, with one line at recovery.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { COMMAND_PREFIX, STANDARD_KEYS, buildDevice, hostIdOf, hostIds } from './devices.js';
import {
  MAX_COMMANDS,
  MAX_HOSTS,
  findCommand,
  findHost,
  parseCommandFields,
  parseHostFields,
} from './hosts.js';
import { loadClientKey } from './keys.js';
import { STANDARD_COMMAND, parseNumber, parseStandard, parseText } from './metrics.js';
import { runSession } from './ssh.js';
import { KEY_STATUS, REASON_TEXT, REPORTS, UserError, lines, say } from './texts.js';

const logger = createLogger({ name: 'ssh' });

export const WIDGET_KEY = 'host';
export const TRIGGERS = {
  UNREACHABLE: 'host_unreachable',
  BACK: 'host_back',
  COMMAND_FAILED: 'command_failed',
};

// Characters of a command output kept in scene outputs and trigger variables.
export const MAX_OUTPUT_CHARS = 1000;

export const DEFAULT_TIMINGS = {
  concurrency: 4,
  retryDelayMs: 5000,
  heartbeatMs: 12 * 60 * 60 * 1000,
  standardTimeoutMs: 10_000,
  // requestWidgetRefresh is rate-limited to one call every 10 s by the core.
  widgetRefreshMs: 10_000,
};

// Failures worth a second try: the network, not the credentials.
const TRANSIENT = new Set(['timeout', 'refused', 'unreachable', 'error']);

const cut = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** The output a scene or a trigger gets: stdout, else stderr, trimmed and capped. */
export function outputOf(result) {
  const out = (result.stdout || '').trim() || (result.stderr || '').trim();
  return cut(out, MAX_OUTPUT_CHARS);
}

export class Monitor {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK fake)
   * @param {object} options.store see src/store.js
   * @param {Function} [options.session] `(target, commands, options)`, src/ssh.js runSession
   * @param {Function} [options.loadKey] src/keys.js loadClientKey
   * @param {boolean} [options.timers] false: no background timer (tests drive the cycles)
   * @param {Function} [options.now] clock in ms
   * @param {Function} [options.sleep] `(ms) => Promise`
   * @param {object} [options.timings] overrides of DEFAULT_TIMINGS
   */
  constructor({ gladys, store, session, loadKey, timers = true, now, sleep, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.session = session ?? runSession;
    this.loadKey = loadKey ?? loadClientKey;
    this.timers = timers;
    this.now = now ?? (() => Date.now());
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.config = null;
    this.key = null;
    this.keyError = null;
    this.hosts = new Map();
    this.status = new Map();
    this.cycleTimer = null;
    this.running = null;
    this.reading = new Map();
    this.lastRefreshAt = -Infinity;
    this.refreshTimer = null;
    this.stopped = false;
    this.failing = new Set();
  }

  /** Log a failure once (warn or error), then at debug until `recovered(key)`. */
  failed(key, level, message) {
    if (this.failing.has(key)) {
      logger.debug(message);
      return;
    }
    this.failing.add(key);
    logger[level](message);
  }

  /** One line when a failure logged by `failed(key)` is over. */
  recovered(key, message) {
    if (this.failing.delete(key)) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    const saved = await this.store.load();
    for (const entry of Array.isArray(saved.hosts) ? saved.hosts : []) {
      if (entry?.id && entry.name && this.hosts.size < MAX_HOSTS) {
        this.hosts.set(entry.id, { ...entry, commands: entry.commands ?? [] });
        this.status.set(entry.id, {
          reachable: entry.lastReachable ?? null,
          reason: entry.lastReason ?? null,
          downSince: entry.downSince ?? null,
          metrics: {},
          sensors: new Map((entry.failedSensors ?? []).map((id) => [id, { ok: false }])),
        });
      }
    }
    await this.refreshKey();
    await this.publishDiscovered();
    logger.info(
      `Started: ${this.hosts.size} host(s), read every ${config.pollInterval / 60} min, ${
        this.key?.source === 'config' ? 'key of the configuration' : 'own key'
      } ${this.key?.fingerprint ?? '(none)'}`,
    );
    this.schedule();
    this.running = this.runCycle();
  }

  /** Reconnection: Gladys may have restarted, publish everything again. */
  async resync(config) {
    this.config = config;
    await this.refreshKey();
    await this.publishDiscovered();
    this.gladys.forgetPublishedStates?.();
    await this.publishStates(this.createdHosts());
    this.requestRefresh();
  }

  async reconfigure(config) {
    const keyChanged =
      config.privateKey !== this.config?.privateKey ||
      config.passphrase !== this.config?.passphrase;
    const structureChanged =
      config.language !== this.config?.language ||
      config.standardMetrics !== this.config?.standardMetrics;
    this.config = config;
    if (keyChanged) {
      await this.refreshKey();
    }
    // Feature names and the standard features apply through "Update" in the
    // Discover tab: the core never changes a created device by itself.
    await this.publishDiscovered();
    this.schedule();
    if (structureChanged) {
      this.requestRefresh();
    }
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.cycleTimer);
    clearTimeout(this.refreshTimer);
    this.cycleTimer = null;
    await this.running?.catch(() => {});
    await this.store.flush();
  }

  schedule() {
    if (!this.timers || this.stopped) {
      return;
    }
    clearInterval(this.cycleTimer);
    this.cycleTimer = setInterval(() => {
      this.running = this.runCycle();
    }, this.config.pollInterval * 1000);
    this.cycleTimer.unref?.();
  }

  async refreshKey() {
    try {
      this.key = await this.loadKey({
        directory: this.store.directory,
        privateKey: this.config.privateKey,
        passphrase: this.config.passphrase,
      });
      this.keyError = null;
      await this.gladys.setConnectionStatus(true);
    } catch (err) {
      this.key = null;
      this.keyError = err.code === 'keyPassphrase' ? 'keyPassphrase' : 'keyInvalid';
      logger.error(`Client key unusable: ${err.message}`);
      await this.gladys
        .setConnectionStatus(false, KEY_STATUS[this.keyError])
        .catch((error) => logger.debug(`Connection status refused: ${error.message}`));
    }
  }

  save() {
    return this.store.save({
      hosts: [...this.hosts.values()].map((host) => {
        const status = this.status.get(host.id);
        return {
          ...host,
          lastReachable: status?.reachable ?? null,
          lastReason: status?.reason ?? null,
          downSince: status?.downSince ?? null,
          failedSensors: [...(status?.sensors ?? new Map())]
            .filter(([, sensor]) => sensor.ok === false)
            .map(([id]) => id),
        };
      }),
    });
  }

  // --- Devices ---------------------------------------------------------------

  deviceIdOf(host) {
    return hostIds(this.gladys, host.id).device;
  }

  /** Hosts whose device the user created in Gladys. */
  createdHosts() {
    const created = new Set(
      (this.gladys.devices ?? []).map((device) => hostIdOf(this.gladys, device.external_id)),
    );
    return [...this.hosts.values()].filter((host) => created.has(host.id));
  }

  /** The host of a device external id (a select of a scene or a widget). */
  hostOfDevice(externalId) {
    const host = this.hosts.get(hostIdOf(this.gladys, externalId));
    if (!host) {
      throw new UserError('unknownHost', { value: String(externalId ?? '') });
    }
    return host;
  }

  statusOf(host) {
    let status = this.status.get(host.id);
    if (!status) {
      status = { reachable: null, reason: null, downSince: null, metrics: {}, sensors: new Map() };
      this.status.set(host.id, status);
    }
    return status;
  }

  async publishDiscovered() {
    const devices = [...this.hosts.values()].map((host) =>
      buildDevice(this.gladys, host, this.config),
    );
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.recovered('discovery', 'Publishing the discovered devices works again');
    } catch (err) {
      this.failed('discovery', 'warn', `Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /** The states of a host, from its last read. */
  statesOf(host) {
    const ids = hostIds(this.gladys, host.id);
    const status = this.statusOf(host);
    const states = [];
    if (status.reachable !== null) {
      states.push({
        device_feature_external_id: ids.feature('reachable'),
        state: status.reachable ? 1 : 0,
      });
    }
    if (this.config.standardMetrics && status.reachable) {
      const values = {
        load: status.metrics.load,
        memory: status.metrics.memory,
        disk: status.metrics.disk,
        uptime: status.metrics.uptimeDays,
      };
      for (const key of STANDARD_KEYS) {
        if (values[key] !== null && values[key] !== undefined) {
          states.push({ device_feature_external_id: ids.feature(key), state: values[key] });
        }
      }
    }
    for (const command of host.commands) {
      const sensor = status.sensors.get(command.id);
      if (command.kind !== 'action' && sensor?.value !== undefined && sensor.value !== null) {
        const id = ids.feature(`${COMMAND_PREFIX}${command.id}`);
        states.push(
          command.kind === 'text'
            ? { device_feature_external_id: id, text: sensor.value }
            : { device_feature_external_id: id, state: sensor.value },
        );
      }
    }
    return states;
  }

  async publishStates(hosts) {
    const states = hosts.flatMap((host) => this.statesOf(host));
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.recovered('states', 'Publishing the states works again');
    } catch (err) {
      this.failed('states', 'warn', `Publishing the states failed: ${err.message}`);
    }
  }

  async onDeviceCreated(device) {
    const id = hostIdOf(this.gladys, device?.external_id);
    const host = id && this.hosts.get(id);
    if (!host) {
      return;
    }
    // States sent before the creation were dropped by the core: send them all.
    for (const feature of device.features ?? []) {
      this.gladys.forgetPublishedStates?.(feature.external_id);
    }
    if (this.statusOf(host).reachable === null) {
      await this.readHost(host);
    } else {
      await this.publishStates([host]);
    }
    this.requestRefresh();
  }

  requestRefresh() {
    if (this.stopped) {
      return;
    }
    const wait = this.lastRefreshAt + this.timings.widgetRefreshMs - this.now();
    if (wait <= 0) {
      this.lastRefreshAt = this.now();
      try {
        this.gladys.requestWidgetRefresh(WIDGET_KEY);
      } catch (err) {
        logger.debug(`Widget refresh refused: ${err.message}`);
      }
      return;
    }
    if (!this.refreshTimer && this.timers) {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.requestRefresh();
      }, wait);
      this.refreshTimer.unref?.();
    }
  }

  // --- SSH -------------------------------------------------------------------

  /**
   * One session on a host. Learns the host key on first contact (and saves
   * it). Throws an SshError (`code`), or `{ code: 'key' }` without a usable key.
   */
  async connect(host, commands) {
    if (!this.key) {
      const error = new Error('No usable client key');
      error.code = 'auth';
      throw error;
    }
    const result = await this.session(
      { address: host.address, port: host.port, username: host.username, password: host.password },
      commands,
      { key: this.key, knownFingerprint: host.fingerprint ?? null },
    );
    if (!host.fingerprint && result.fingerprint) {
      host.fingerprint = result.fingerprint;
      logger.info(`${host.name}: host key ${result.fingerprint} remembered`);
      this.save();
    }
    return result;
  }

  async connectWithRetry(host, commands) {
    try {
      return await this.connect(host, commands);
    } catch (err) {
      if (!(TRANSIENT.has(err.code) || err.transient) || this.stopped) {
        throw err;
      }
      logger.debug(`${host.name}: ${err.code}, trying again`);
      await this.sleep(this.timings.retryDelayMs);
      return this.connect(host, commands);
    }
  }

  /** Reads a host once (standard figures and sensors), publishes, fires the triggers. */
  readHost(host) {
    // One read per host at a time: a cycle and a device creation can meet.
    const current = this.reading.get(host.id);
    if (current) {
      return current;
    }
    const promise = this.doReadHost(host).finally(() => this.reading.delete(host.id));
    this.reading.set(host.id, promise);
    return promise;
  }

  async doReadHost(host) {
    const status = this.statusOf(host);
    const sensors = host.commands.filter((command) => command.kind !== 'action');
    const commands = [
      ...(this.config.standardMetrics
        ? [{ command: STANDARD_COMMAND, timeoutMs: this.timings.standardTimeoutMs }]
        : []),
      ...sensors.map((command) => ({
        command: command.command,
        timeoutMs: command.timeout * 1000,
      })),
    ];
    let results;
    try {
      ({ results } = await this.connectWithRetry(host, commands));
    } catch (err) {
      await this.markUnreachable(host, err);
      return;
    }
    if (results.some((result) => result.disconnected)) {
      await this.markUnreachable(host, { code: 'error' });
      return;
    }
    const wasDown = status.reachable === false;
    const downSince = status.downSince;
    status.reachable = true;
    status.reason = null;
    status.downSince = null;
    status.checkedAt = this.now();
    if (this.config.standardMetrics) {
      status.metrics = parseStandard(results.shift().stdout);
    }
    const failures = [];
    sensors.forEach((command, index) => {
      const result = results[index];
      const value =
        result.code === 0
          ? command.kind === 'text'
            ? parseText(result.stdout)
            : parseNumber(result.stdout)
          : null;
      const previous = status.sensors.get(command.id);
      if (value === null) {
        status.sensors.set(command.id, { ok: false, value: previous?.value ?? null });
        if (previous?.ok !== false) {
          failures.push({ command, result });
        }
      } else {
        status.sensors.set(command.id, { ok: true, value });
      }
    });
    if (wasDown) {
      logger.info(`${host.name} is reachable again`);
      await this.fire(TRIGGERS.BACK, {
        device: this.deviceIdOf(host),
        name: host.name,
        address: host.address,
        down_minutes: downSince ? Math.round((this.now() - downSince) / 60000) : 0,
      });
    }
    for (const { command, result } of failures) {
      logger.info(`${host.name}: sensor "${command.name}" failed`);
      await this.fireCommandFailed(host, command, result);
    }
    await this.publishStates([host]);
    this.save();
  }

  async markUnreachable(host, err) {
    const status = this.statusOf(host);
    const reason = err.code ?? 'error';
    const wasUp = status.reachable !== false;
    const previousReason = status.reason;
    status.reachable = false;
    status.reason = reason;
    status.checkedAt = this.now();
    if (wasUp) {
      status.downSince = this.now();
      logger.info(`${host.name} is unreachable: ${reason}`);
      await this.fire(TRIGGERS.UNREACHABLE, {
        device: this.deviceIdOf(host),
        name: host.name,
        address: host.address,
        reason,
      });
    } else {
      logger.debug(`${host.name} still unreachable: ${reason}`);
    }
    await this.publishStates([host]);
    if (wasUp || previousReason !== reason) {
      this.save();
    }
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  fireCommandFailed(host, command, result) {
    return this.fire(TRIGGERS.COMMAND_FAILED, {
      device: this.deviceIdOf(host),
      name: host.name,
      command: command.name,
      exit_code: result.timedOut || result.code === null ? -1 : result.code,
      output: outputOf(result),
    });
  }

  async runCycle() {
    if (this.stopped) {
      return;
    }
    const hosts = this.createdHosts();
    logger.debug(`Read cycle: ${hosts.length} host(s)`);
    try {
      const queue = [...hosts];
      const worker = async () => {
        while (queue.length > 0 && !this.stopped) {
          await this.readHost(queue.shift());
        }
      };
      await Promise.all(Array.from({ length: this.timings.concurrency }, worker));
      this.recovered('cycle', 'Read cycles work again');
    } catch (err) {
      this.failed('cycle', 'error', `Read cycle failed: ${err.message}`);
    }
    if (hosts.length > 0) {
      this.requestRefresh();
    }
  }

  /** Records the value of a sensor read outside a cycle, and publishes it. */
  async recordSensor(host, command, result) {
    const value =
      result.code !== 0
        ? null
        : command.kind === 'text'
          ? parseText(result.stdout)
          : parseNumber(result.stdout);
    if (value !== null) {
      this.statusOf(host).sensors.set(command.id, { ok: true, value });
      if (this.createdHosts().some((entry) => entry.id === host.id)) {
        await this.publishStates([host]);
      }
    }
    return value;
  }

  /**
   * Runs one declared command (scene, widget). Never throws for a failure of
   * the command or the host: the result says it, and `command_failed` fires.
   * @returns {Promise<{success: boolean, code: number, output: string, timedOut: boolean, reason?: string}>}
   */
  async runCommand(host, command, origin) {
    logger.info(`Running "${command.name}" on ${host.name} (${origin})`);
    let result;
    try {
      ({
        results: [result],
      } = await this.connect(host, [
        { command: command.command, timeoutMs: command.timeout * 1000 },
      ]));
    } catch (err) {
      const reason = err.code ?? 'error';
      logger.info(`"${command.name}" not run on ${host.name}: ${reason}`);
      const text = REASON_TEXT[this.config.language]?.[reason] ?? reason;
      await this.fireCommandFailed(host, command, { code: null, stdout: '', stderr: text });
      return { success: false, code: -1, output: text, timedOut: false, reason };
    }
    if (result.disconnected) {
      // A reboot or an sshd restart closes the connection: the command was
      // sent, its result cannot be known. Not reported as a failure.
      logger.info(`"${command.name}" on ${host.name}: connection closed during the command`);
      return {
        success: false,
        code: -1,
        output: 'connection closed',
        timedOut: false,
        disconnected: true,
      };
    }
    const success = result.code === 0 && !result.timedOut;
    if (success && command.kind !== 'action') {
      await this.recordSensor(host, command, result);
    }
    if (!success) {
      logger.info(
        `"${command.name}" failed on ${host.name}: ${result.timedOut ? 'timeout' : `exit ${result.code}`}`,
      );
      await this.fireCommandFailed(host, command, result);
    }
    return {
      success,
      code: result.timedOut || result.code === null ? -1 : result.code,
      output: outputOf(result),
      timedOut: Boolean(result.timedOut),
    };
  }

  // --- Configuration actions ---------------------------------------------------

  async addHost(fields) {
    const parsed = parseHostFields(fields);
    const existing = this.hosts.get(parsed.id);
    if (existing && existing.name.toLowerCase() !== parsed.name.toLowerCase()) {
      // Two names, one id ("NAS 2!" and "NAS 2"): refused, never overwritten.
      throw new UserError('nameTaken', { value: existing.name });
    }
    if (!existing && this.hosts.size >= MAX_HOSTS) {
      throw new UserError('tooManyHosts', { max: MAX_HOSTS });
    }
    const moved =
      existing && (existing.address !== parsed.address || existing.port !== parsed.port);
    const host = {
      ...parsed,
      // An empty password field keeps the saved one (it is never shown back).
      password: parsed.password || existing?.password || '',
      // Another address is another machine: its host key is learned again.
      fingerprint: moved ? null : (existing?.fingerprint ?? null),
      commands: existing?.commands ?? [],
    };
    this.hosts.set(host.id, host);
    await this.save();
    await this.publishDiscovered();
    logger.info(`Host ${host.name} ${existing ? 'updated' : 'added'}`);

    const firstContact = !host.fingerprint;
    let report;
    try {
      const { fingerprint } = await this.connect(host, []);
      report = firstContact
        ? say(REPORTS, 'connected', { user: host.username, fingerprint })
        : say(REPORTS, 'connectedKnown', { user: host.username });
    } catch (err) {
      const reason = err.code ?? 'error';
      report = lines(
        sayReason(reason),
        reason === 'auth' ? say(REPORTS, 'authHint') : null,
        reason === 'host_key_changed' ? say(REPORTS, 'keyChangedHint') : null,
      );
    }
    const created = this.createdHosts().some((entry) => entry.id === host.id);
    return lines(
      say(REPORTS, 'hostSaved', { name: host.name }),
      report,
      created ? null : say(REPORTS, 'discover'),
    );
  }

  async removeHost(fields) {
    const host = this.requireHost(fields);
    this.hosts.delete(host.id);
    this.status.delete(host.id);
    await this.save();
    await this.publishDiscovered();
    logger.info(`Host ${host.name} removed`);
    this.requestRefresh();
    return say(REPORTS, 'hostRemoved', { name: host.name });
  }

  /**
   * The host of a configuration action. The `host` select gives the external
   * id of a device (it lists only the hosts created in Gladys), `host_name`
   * the name of a host whose device is not created yet; a name in `host` is
   * still accepted (the free text field of 1.0.0, a direct API call).
   */
  requireHost(fields = {}) {
    const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');
    const value = trimmed(fields.host) || trimmed(fields.host_name);
    if (!value) {
      throw new UserError('hostMissing');
    }
    const id = hostIdOf(this.gladys, value);
    const host = id ? this.hosts.get(id) : findHost(this.hosts, value);
    if (!host) {
      throw new UserError('unknownHost', { value: String(value ?? '') });
    }
    return host;
  }

  requireCommand(host, value) {
    const command = findCommand(host, value);
    if (!command) {
      throw new UserError('unknownCommand', { value: String(value ?? ''), host: host.name });
    }
    return command;
  }

  async addCommand(fields) {
    const host = this.requireHost(fields);
    const command = parseCommandFields(fields);
    const index = host.commands.findIndex((entry) => entry.id === command.id);
    if (index !== -1 && host.commands[index].name.toLowerCase() !== command.name.toLowerCase()) {
      throw new UserError('nameTaken', { value: host.commands[index].name });
    }
    if (index === -1 && host.commands.length >= MAX_COMMANDS) {
      throw new UserError('tooManyCommands', { max: MAX_COMMANDS });
    }
    const previous = index === -1 ? null : host.commands[index];
    if (index === -1) {
      host.commands.push(command);
    } else {
      host.commands[index] = command;
    }
    const status = this.statusOf(host);
    if (previous?.kind !== command.kind || previous?.command !== command.command) {
      status.sensors.delete(command.id);
    }
    await this.save();
    await this.publishDiscovered();
    logger.info(`Command "${command.name}" ${previous ? 'updated' : 'added'} on ${host.name}`);
    this.requestRefresh();

    const created = this.createdHosts().some((entry) => entry.id === host.id);
    const structural = command.kind !== 'action' && (!previous || previous.kind !== command.kind);
    let trial = null;
    // A sensor only reads: it is tried once so the user sees its value. An
    // action is never run on save (it could reboot the machine).
    if (command.kind !== 'action') {
      trial = await this.trySensor(host, command);
    }
    return lines(
      say(REPORTS, 'commandSaved', { name: command.name, host: host.name }),
      trial,
      created && structural ? say(REPORTS, 'updateDevice') : null,
    );
  }

  async trySensor(host, command) {
    let result;
    try {
      ({
        results: [result],
      } = await this.connect(host, [
        { command: command.command, timeoutMs: command.timeout * 1000 },
      ]));
    } catch (err) {
      return sayReason(err.code ?? 'error');
    }
    const value = await this.recordSensor(host, command, result);
    if (value === null) {
      const output = cut(
        outputOf(result) || (result.timedOut ? 'timeout' : `exit ${result.code}`),
        120,
      );
      return say(REPORTS, 'triedFailed', { output });
    }
    return say(REPORTS, 'tried', { value: `${value}${command.unit ? ` (${command.unit})` : ''}` });
  }

  async removeCommand(fields) {
    const host = this.requireHost(fields);
    const command = this.requireCommand(host, fields.name);
    host.commands = host.commands.filter((entry) => entry.id !== command.id);
    this.statusOf(host).sensors.delete(command.id);
    await this.save();
    await this.publishDiscovered();
    logger.info(`Command "${command.name}" removed from ${host.name}`);
    this.requestRefresh();
    return say(REPORTS, 'commandRemoved', { name: command.name, host: host.name });
  }

  async forgetHostKey(fields) {
    const host = this.requireHost(fields);
    host.fingerprint = null;
    await this.save();
    logger.info(`Host key of ${host.name} forgotten`);
    return say(REPORTS, 'hostKeyForgotten', { name: host.name });
  }

  showPublicKey() {
    if (!this.key) {
      throw new UserError(this.keyError ?? 'keyInvalid');
    }
    return lines(
      say(REPORTS, 'publicKey', { source: this.key.source }),
      this.key.publicLine,
      this.key.fingerprint,
      '',
      say(REPORTS, 'authorizedKeys'),
      `no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ${this.key.publicLine}`,
    );
  }

  listHosts() {
    if (this.hosts.size === 0) {
      return say(REPORTS, 'empty');
    }
    const blocks = [...this.hosts.values()].map((host) => {
      const status = this.statusOf(host);
      const stateKey =
        status.reachable === true
          ? 'online'
          : status.reachable === false
            ? 'offline'
            : 'notChecked';
      const state = Object.fromEntries(
        Object.entries(say(REPORTS, stateKey)).map(([lang, text]) => [
          lang,
          status.reachable === false && status.reason
            ? `${text} (${REASON_TEXT[lang][status.reason] ?? status.reason})`
            : text,
        ]),
      );
      const header = Object.fromEntries(
        Object.entries(state).map(([lang, text]) => [
          lang,
          REPORTS[lang].listHost({
            name: host.name,
            user: host.username,
            address: host.address,
            port: host.port,
            state: text,
          }),
        ]),
      );
      const commands =
        host.commands.length === 0
          ? say(REPORTS, 'noCommand')
          : host.commands
              .map((command) => `${command.name} [${command.kind}${command.button ? ', ▶' : ''}]`)
              .join(' · ');
      return lines(header, typeof commands === 'string' ? `  ${commands}` : prefix(commands, '  '));
    });
    return lines(...blocks);
  }
}

function sayReason(reason) {
  return Object.fromEntries(
    Object.keys(REPORTS).map((lang) => [
      lang,
      REPORTS[lang].failed({ reason: REASON_TEXT[lang][reason] ?? REASON_TEXT[lang].error }),
    ]),
  );
}

const prefix = (texts, start) =>
  Object.fromEntries(Object.entries(texts).map(([lang, text]) => [lang, `${start}${text}`]));
