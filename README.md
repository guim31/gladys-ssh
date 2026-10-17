# SSH for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that watches your Linux machines — a home server, a NAS, a Raspberry Pi — over
**SSH**, and runs from Gladys the commands **you declared** in its
configuration: restart a service, start a backup, read a temperature. Local
only: no cloud, no account, nothing to install on the machines but an SSH
server.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

> Tested against a real OpenSSH server (`linuxserver/openssh-server` in
> Docker), with a key and with a password, from the locked-down container
> Gladys runs. Not yet in a real Gladys: feedback welcome in the
> [issues](https://github.com/guim31/gladys-ssh/issues).

## Features

- **One device per machine**, proposed in the Discover tab: _Reachable_,
  _Load (1 min)_, _Memory used_, _Disk used (/)_ and _Uptime_, read every 1 to
  30 minutes (the four figures can be turned off).
- **Custom sensors**: a command whose output is a number (with a unit) or a
  text becomes a feature of the device.
- **Declared commands only**: scenes and widget buttons name a command of the
  configuration; nothing they send is ever added to it. Each command has a
  time limit (KILL signal, then the channel is closed) and a capped output.
- **Scene triggers**: _A host became unreachable_ (with the reason: timeout,
  refused, authentication, host key changed…), _A host is reachable again_
  (with the downtime), _A command failed_ (exit code and output).
- **Scene action** _Run an SSH command_: success, exit code and output as
  outputs.
- **Dashboard widget** per machine: state, figures, sensors, and up to four
  command buttons.
- **Its own Ed25519 key**, generated at the first start and kept in the
  integration's private volume: the user only copies the public key to
  `authorized_keys`. A private key of your own (OpenSSH or PEM, encrypted or
  not) or a password per host also work.
- **Host keys trusted on first use**, then checked: a machine presenting
  another key is refused before any authentication.
- Texts in English, French, German and Spanish.

Its neighbours: [Glances](https://github.com/guim31/gladys-glances) and
[Netdata](https://github.com/guim31/gladys-netdata) read those monitoring
tools when they are installed (much richer figures), and
[Ping & Wake-on-LAN](https://github.com/guim31/gladys-ping-wol) watches any
device on the network and wakes it up. SSH needs nothing on the machine but
its SSH server, and is the one that **acts** on it.

## Requirements

- Gladys Assistant **5.1.0** or later.
- Machines with an SSH server reachable from Gladys, and a POSIX shell. The
  standard figures read `/proc` and `df` (GNU or BusyBox).

## Installation

In Gladys: **Integrations → Install from GitHub**, address
`https://github.com/guim31/gladys-ssh`. Then follow the
[documentation](docs/en.md): show the public key, authorize it for a
dedicated user on each machine, add the hosts, create their devices, declare
the commands.

## Security

- Only the commands declared in the configuration run; their text is sent as
  is, as `ssh user@host 'command'` would. Scene parameters are never passed
  to a command.
- The documentation recommends a dedicated user, the `no-pty` /
  `no-port-forwarding` options in `authorized_keys`, and sudo rules limited to
  one command.
- The private key and the optional passwords live in `/data`, the
  integration's private volume (files in mode 600); they never appear in the
  logs, the action results nor the device parameters.

## Limitations

- Linux and other POSIX systems; no Windows-specific figures.
- One SSH session per host and cycle; at most 20 hosts, 15 commands per host,
  4 widget buttons.
- A command over its time limit gets a KILL signal (honoured by OpenSSH 7.9
  and later) and its channel is closed; an older server may let it finish.
- Legacy encrypted PEM keys (`Proc-Type` headers) cannot be pasted: convert
  them with `ssh-keygen -p`.
- mDNS names (`.local`) do not resolve in the container: use the address.

## Development

Node.js 22+, ESM, no build step. Runtime dependencies:
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and [`ssh2`](https://github.com/mscdex/ssh2) (pure JavaScript; its optional
native accelerators are not needed).

```bash
npm install
npm test              # node --test: the SDK's fake Gladys, simulated machines, a loopback ssh2 server
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store --skip-image-check .   # store validator
```

```
index.js              SDK wiring (src/app.js registers the handlers)
src/app.js            handlers → monitor, configuration actions
src/monitor.js        hosts, read cycles, states, triggers, commands, configuration actions
src/ssh.js            one SSH session: host key check, authentication, commands with timeouts
src/keys.js           the client key: generated, or pasted and rebuilt
src/metrics.js        standard figures (/proc, df) and custom sensor parsing
src/hosts.js          validation of the host and command fields, ids
src/devices.js        Gladys device of a host (features, units)
src/scenes.js         scene action
src/widgets.js        dashboard widget
src/texts.js          texts sent from the container, four languages
src/store.js          /data persistence
src/config.js         configuration defaults and normalization
```

## Credits

- [ssh2](https://github.com/mscdex/ssh2) (MIT, Brian White): the SSH client,
  and the in-process server of the tests.
- [linuxserver/openssh-server](https://github.com/linuxserver/docker-openssh-server)
  (GPL-3.0, used as a test target only): the real server the integration was
  tested against; the Alpine output in `test/fixtures/metrics` comes from it.
- [Home Assistant](https://www.home-assistant.io)'s
  [`command_line`](https://www.home-assistant.io/integrations/command_line/)
  integration (Apache-2.0) for the shape users expect from command sensors
  (value, unit, timeout). No code was taken from it.

Not affiliated with OpenSSH, the OpenBSD project, nor Home Assistant.

## License

Apache-2.0, see [LICENSE](LICENSE).
