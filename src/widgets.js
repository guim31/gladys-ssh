// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `host`.
//
// One host at a glance: a status list (reachable or why not, load, memory,
// disk, uptime, the custom sensors) and a button for each command marked
// "button" in the configuration, which runs it and shows the result in a
// toast. Budget (8 components, 2 texts at most): one status list, 4 buttons at
// most, or one text when there is nothing to show.
//
// Button keys are numbered (`run_1`…): the core drops a button whose action
// key is already taken. Host and command travel in `params`, which the core
// echoes from the content, never from the request; the command is looked up
// again among the declared ones before it runs.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './monitor.js';
import { REASON_TEXT, RUNS, WIDGET_TEXT, lines, say } from './texts.js';

export const MAX_BUTTONS = 4;
export const MAX_STATUS_ITEMS = 10;
export const TTL_SECONDS = 60;
const BUTTON_PREFIX = 'run_';
const MAX_LABEL = 40;
const MAX_TOAST = 200;

const t = (text, language) => text[language] ?? text.en;
const cut = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** Uptime in days → "12 d 4 h" (localized unit letters). */
export function formatUptime(days, language) {
  const totalHours = Math.floor(days * 24);
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  const dayUnit = t(WIDGET_TEXT.days, language);
  const hourUnit = t(WIDGET_TEXT.hours, language);
  return d > 0 ? `${d} ${dayUnit} ${h} ${hourUnit}` : `${h} ${hourUnit}`;
}

const level = (value, warn, danger) =>
  value >= danger
    ? WIDGET_COLORS.DANGER
    : value >= warn
      ? WIDGET_COLORS.WARNING
      : WIDGET_COLORS.SUCCESS;

function statusItems(monitor, host, language) {
  const status = monitor.statusOf(host);
  const items = [];
  if (status.reachable === true) {
    items.push({
      label: t(WIDGET_TEXT.state, language),
      value: t(WIDGET_TEXT.online, language),
      color: WIDGET_COLORS.SUCCESS,
    });
  } else if (status.reachable === false) {
    const reason = REASON_TEXT[language]?.[status.reason];
    items.push({
      label: t(WIDGET_TEXT.state, language),
      value: cut(
        reason
          ? `${t(WIDGET_TEXT.offline, language)} · ${reason}`
          : t(WIDGET_TEXT.offline, language),
        MAX_LABEL,
      ),
      color: WIDGET_COLORS.DANGER,
    });
  } else {
    items.push({
      label: t(WIDGET_TEXT.state, language),
      value: t(WIDGET_TEXT.unknown, language),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (status.reachable === true && monitor.config.standardMetrics) {
    const m = status.metrics;
    if (m.load !== null && m.load !== undefined) {
      items.push({ label: t(WIDGET_TEXT.load, language), value: String(m.load) });
    }
    if (m.memory !== null && m.memory !== undefined) {
      items.push({
        label: t(WIDGET_TEXT.memory, language),
        value: `${m.memory} %`,
        color: level(m.memory, 80, 95),
      });
    }
    if (m.disk !== null && m.disk !== undefined) {
      items.push({
        label: t(WIDGET_TEXT.disk, language),
        value: `${m.disk} %`,
        color: level(m.disk, 80, 95),
      });
    }
    if (m.uptimeDays !== null && m.uptimeDays !== undefined) {
      items.push({
        label: t(WIDGET_TEXT.uptime, language),
        value: formatUptime(m.uptimeDays, language),
      });
    }
  }
  for (const command of host.commands.filter((entry) => entry.kind !== 'action')) {
    const sensor = status.sensors.get(command.id);
    if (sensor?.value !== undefined && sensor.value !== null && items.length < MAX_STATUS_ITEMS) {
      const unit = command.unit === 'percent' ? ' %' : command.unit === 'celsius' ? ' °C' : '';
      items.push({
        label: cut(command.name, MAX_LABEL),
        value: cut(`${sensor.value}${unit}`, MAX_LABEL),
        // A failing sensor, or an offline host: the value shown is the last one.
        ...(sensor.ok === false || status.reachable === false
          ? { color: WIDGET_COLORS.WARNING }
          : {}),
      });
    }
  }
  return items;
}

/** The host a widget instance shows: the chosen device, else the first created host. */
function selectedHost(monitor, settings) {
  const created = monitor.createdHosts();
  if (settings?.device) {
    return created.find((host) => monitor.deviceIdOf(host) === settings.device);
  }
  return created[0];
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(monitor, { settings, language = 'en' }) {
      const host = selectedHost(monitor, settings);
      if (!host) {
        return {
          ttl_seconds: TTL_SECONDS,
          components: [{ type: 'text', variant: 'body', text: t(WIDGET_TEXT.empty, language) }],
        };
      }
      const components = [{ type: 'status', items: statusItems(monitor, host, language) }];
      host.commands
        .filter((command) => command.button)
        .slice(0, MAX_BUTTONS)
        .forEach((command, index) => {
          components.push({
            type: 'button',
            label: cut(command.name, 24),
            icon: command.kind === 'action' ? 'play' : 'refresh-cw',
            style: 'secondary',
            action: {
              key: `${BUTTON_PREFIX}${index + 1}`,
              params: { host: host.id, command: command.id },
              // An action asks before running (Gladys 5.2.0+; older cores
              // drop the field and run it on the tap).
              ...(command.kind === 'action' ? { confirm: true } : {}),
            },
          });
        });
      return { ttl_seconds: TTL_SECONDS, components };
    },

    async action(monitor, { actionKey, params }) {
      const host = actionKey.startsWith(BUTTON_PREFIX)
        ? monitor.hosts.get(params?.host)
        : undefined;
      const command = host?.commands.find((entry) => entry.id === params?.command && entry.button);
      if (!command) {
        return say(RUNS, 'gone');
      }
      const result = await monitor.runCommand(host, command, 'widget');
      if (result.reason) {
        return Object.fromEntries(
          Object.keys(RUNS).map((lang) => [
            lang,
            cut(
              RUNS[lang].unreachable({
                name: command.name,
                reason: REASON_TEXT[lang][result.reason] ?? result.reason,
              }),
              MAX_TOAST,
            ),
          ]),
        );
      }
      if (result.disconnected) {
        return say(RUNS, 'disconnected', { name: command.name });
      }
      const head = result.timedOut
        ? say(RUNS, 'timedOut', { name: command.name, seconds: command.timeout })
        : result.success
          ? say(RUNS, 'ok', { name: command.name })
          : say(RUNS, 'failed', { name: command.name, code: result.code });
      const firstLine = (result.output || '').split('\n')[0];
      const message = lines(head, firstLine || null);
      return Object.fromEntries(
        Object.entries(message).map(([lang, text]) => [lang, cut(text, MAX_TOAST)]),
      );
    },
  },
};
