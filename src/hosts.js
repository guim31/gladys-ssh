// -----------------------------------------------------------------------------
// Hosts and commands as the configuration actions describe them: validation of
// the fields, and the stable ids the external ids are built from.
//
// Ids are slugs of the names ("Home server" → "home-server"): saving a host or
// a command again under the same name updates it and keeps its device and
// features; a user who lost /data gets the same devices back by adding the
// hosts again under the same names.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { SENSOR_UNITS } from './devices.js';
import { LANGS, NAMES, UserError } from './texts.js';

export const MAX_HOSTS = 20;
export const MAX_COMMANDS = 15;
export const MAX_NAME_LENGTH = 40;
export const MAX_COMMAND_LENGTH = 1000;
export const COMMAND_KINDS = ['action', 'number', 'text'];
// Seconds a command may run; empty field: DEFAULT_COMMAND_TIMEOUT.
export const COMMAND_TIMEOUTS = ['5', '10', '30', '60', '90'];
export const DEFAULT_COMMAND_TIMEOUT = 10;

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;
const USERNAME = /^[a-z_][a-z0-9_.@-]{0,63}\$?$/i;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const isTrue = (value) => value === true || value === 'true' || value === 1 || value === '1';

/** A stable id from a name: lowercase ASCII, dashes, 32 characters at most. */
export function slug(name) {
  const base = String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return base || createHash('sha256').update(String(name)).digest('hex').slice(0, 12);
}

function validName(value, missing = 'name') {
  const name = text(value);
  if (!name) {
    throw new UserError(missing);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new UserError('nameLength', { max: MAX_NAME_LENGTH });
  }
  return name;
}

function validPort(value) {
  if (value === undefined || value === null || value === '') {
    return 22;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UserError('port', { value });
  }
  return port;
}

/**
 * The fields of "Add or update a host", validated.
 * @returns {{id, name, address, port, username, password}}
 */
export function parseHostFields(fields = {}) {
  const name = validName(fields.name);
  const address = text(fields.address).replace(/^\[(.*)\]$/, '$1');
  if (!address || (!isIP(address) && !HOSTNAME.test(address))) {
    throw new UserError('address', { value: text(fields.address) });
  }
  const username = text(fields.username);
  if (!USERNAME.test(username)) {
    throw new UserError('username');
  }
  return {
    id: slug(name),
    name,
    address,
    port: validPort(fields.port),
    username,
    // Not trimmed: a password may start or end with a space.
    password: typeof fields.password === 'string' && fields.password !== '' ? fields.password : '',
  };
}

// Names the standard features take, in every language: a sensor named like
// one would make two features with the same name on the device.
const RESERVED = new Set(
  LANGS.flatMap((lang) => Object.values(NAMES[lang])).map((name) => name.toLowerCase()),
);

/**
 * The fields of "Add or update a command", validated (the host is resolved by
 * the caller).
 */
export function parseCommandFields(fields = {}) {
  const name = validName(fields.name, 'commandName');
  if (RESERVED.has(name.toLowerCase())) {
    throw new UserError('reservedName', { value: name });
  }
  const command = text(fields.command);
  if (!command) {
    throw new UserError('command');
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new UserError('commandLength', { max: MAX_COMMAND_LENGTH });
  }
  const kind = text(fields.kind);
  if (!COMMAND_KINDS.includes(kind)) {
    throw new UserError('kind');
  }
  const unit =
    kind === 'number' && SENSOR_UNITS.includes(text(fields.unit)) ? text(fields.unit) : '';
  const timeout = COMMAND_TIMEOUTS.includes(String(fields.timeout))
    ? Number(fields.timeout)
    : DEFAULT_COMMAND_TIMEOUT;
  return {
    id: slug(name),
    name,
    command,
    kind,
    unit,
    timeout,
    button: isTrue(fields.button),
  };
}

/** Finds a host by name (or id), case- and accent-insensitive. */
export function findHost(hosts, value) {
  const wanted = text(value);
  if (!wanted) {
    return undefined;
  }
  return hosts.get(slug(wanted)) ?? [...hosts.values()].find((host) => host.name === wanted);
}

/** Finds a command of a host by name (or id). */
export function findCommand(host, value) {
  const wanted = text(value);
  if (!host || !wanted) {
    return undefined;
  }
  const id = slug(wanted);
  return host.commands.find((command) => command.id === id || command.name === wanted);
}
