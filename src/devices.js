// -----------------------------------------------------------------------------
// One Gladys device per SSH host, proposed in the Discover tab once the host is
// added in the configuration.
//
// Features (couples checked against the core table, test/gladys-rules.test.js):
//   - reachable  input/binary: 1 when the SSH session opens (address, port,
//                host key and authentication all good);
//   - load       unknown/unknown: load average over 1 minute (no core
//                category, the couple gladys-glances already uses);
//   - memory     level-sensor/liquid-level-percent: memory used, 0-100 %;
//   - disk       level-sensor/liquid-level-percent: space used on `/`;
//   - uptime     duration/decimal, in days;
//   - one feature per custom sensor (a declared command whose output is a
//     number or a text), its couple chosen from its unit (see SENSOR_SHAPES).
// The four standard figures can be turned off in the configuration (a machine
// without /proc, or a forced command): only `reachable` and the sensors stay.
//
// Commands of kind "action" are no features: they run from the widget and the
// scene action only (a dashboard "push" button would run them on a single
// mis-tap, without confirmation nor feedback).
//
// Published with should_poll: false: the cadence is in minutes, above what the
// core scheduler offers; the container reads the hosts on its own timer.
// -----------------------------------------------------------------------------

import { NAMES } from './texts.js';

export const DEVICE_TYPE = 'host';
export const STANDARD_KEYS = ['load', 'memory', 'disk', 'uptime'];
export const COMMAND_PREFIX = 'cmd-';
export const MODEL = 'SSH';

// Display bounds (the core never enforces min/max: they place the gauge).
export const BOUNDS = { LOAD_MAX: 64, UPTIME_MAX_DAYS: 3650 };

const percent = {
  category: 'level-sensor',
  type: 'liquid-level-percent',
  unit: 'percent',
  min: 0,
  max: 100,
};

// Feature shape of a numeric sensor, by unit ('' = no unit).
export const SENSOR_SHAPES = {
  '': { category: 'unknown', type: 'unknown', min: 0, max: 1_000_000 },
  percent,
  celsius: { category: 'device-temperature-sensor', type: 'decimal', min: -40, max: 150 },
  seconds: { category: 'duration', type: 'decimal', min: 0, max: 1_000_000 },
  minutes: { category: 'duration', type: 'decimal', min: 0, max: 1_000_000 },
  hours: { category: 'duration', type: 'decimal', min: 0, max: 100_000 },
  days: { category: 'duration', type: 'decimal', min: 0, max: 100_000 },
  megabyte: { category: 'data', type: 'size', min: 0, max: 100_000_000 },
  gigabyte: { category: 'data', type: 'size', min: 0, max: 1_000_000 },
  'megabits-per-second': { category: 'datarate', type: 'rate', min: 0, max: 100_000 },
  watt: { category: 'energy-sensor', type: 'power', min: 0, max: 100_000 },
  volt: { category: 'energy-sensor', type: 'voltage', min: 0, max: 1000 },
};
export const SENSOR_UNITS = Object.keys(SENSOR_SHAPES).filter(Boolean);

/** External ids of a host device: `.device`, and `.feature(key)`. */
export const hostIds = (gladys, hostId) => gladys.externalIds(DEVICE_TYPE, hostId);

/** The host id of a device external id (null if not one of ours). */
export function hostIdOf(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length).split(':')[0] || null;
}

const readOnly = { read_only: true, has_feedback: false };

function sensorFeature(ids, command) {
  const base = {
    name: command.name,
    external_id: ids.feature(`${COMMAND_PREFIX}${command.id}`),
    ...readOnly,
  };
  if (command.kind === 'text') {
    return { ...base, category: 'text', type: 'text', keep_history: false, min: 0, max: 0 };
  }
  const shape = SENSOR_SHAPES[command.unit ?? ''] ?? SENSOR_SHAPES[''];
  const unit = command.unit && shape.unit === undefined ? command.unit : shape.unit;
  return {
    ...base,
    category: shape.category,
    type: shape.type,
    ...(unit ? { unit } : {}),
    keep_history: true,
    min: shape.min,
    max: shape.max,
  };
}

/**
 * The discovery payload of a host.
 * @param {object} gladys
 * @param {object} host see src/hosts.js
 * @param {{language: string, standardMetrics: boolean}} config
 */
export function buildDevice(gladys, host, { language = 'en', standardMetrics = true } = {}) {
  const ids = hostIds(gladys, host.id);
  const names = NAMES[language] ?? NAMES.en;
  const features = [
    {
      name: names.reachable,
      external_id: ids.feature('reachable'),
      category: 'input',
      type: 'binary',
      ...readOnly,
      keep_history: true,
      min: 0,
      max: 1,
    },
  ];
  if (standardMetrics) {
    features.push(
      {
        name: names.load,
        external_id: ids.feature('load'),
        category: 'unknown',
        type: 'unknown',
        ...readOnly,
        keep_history: true,
        min: 0,
        max: BOUNDS.LOAD_MAX,
      },
      {
        name: names.memory,
        external_id: ids.feature('memory'),
        ...percent,
        ...readOnly,
        keep_history: true,
      },
      {
        name: names.disk,
        external_id: ids.feature('disk'),
        ...percent,
        ...readOnly,
        keep_history: true,
      },
      {
        name: names.uptime,
        external_id: ids.feature('uptime'),
        category: 'duration',
        type: 'decimal',
        unit: 'days',
        ...readOnly,
        keep_history: true,
        min: 0,
        max: BOUNDS.UPTIME_MAX_DAYS,
      },
    );
  }
  for (const command of host.commands.filter((entry) => entry.kind !== 'action')) {
    features.push(sensorFeature(ids, command));
  }
  return {
    name: host.name,
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [
      { name: 'ADDRESS', value: host.address },
      { name: 'PORT', value: String(host.port) },
      { name: 'USERNAME', value: host.username },
    ],
    features,
  };
}
