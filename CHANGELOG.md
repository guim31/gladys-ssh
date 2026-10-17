# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]

### Added

- One device per Linux machine, read over SSH every 1 to 30 minutes:
  reachable, load (1 min), memory used, disk used on `/`, uptime.
- Custom sensors: a declared command whose output is a number (with a unit)
  or a text becomes a feature of the device.
- Declared commands, run from the scene action _Run an SSH command_ (success,
  exit code and output as outputs) or from a widget button; nothing else ever
  runs, with a time limit and a capped output for each command.
- Scene triggers: a host became unreachable (with the reason), is reachable
  again (with the downtime), a command failed (exit code and output).
- Dashboard widget _SSH host_: state, figures, sensors and up to four command
  buttons.
- The integration's own Ed25519 key, generated at the first start; your own
  private key (OpenSSH or PEM, with passphrase) or a password per host also
  work. Host keys trusted on first use, then checked.
- Configuration actions to add hosts and commands, show the public key, list
  everything, and accept a new host key after a reinstallation.
- Texts and documentation in English, French, German and Spanish.
