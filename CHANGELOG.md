# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.1.0] - 2026-10-22

### Changed

- The host of **Add or update a command**, **Remove a command**, **Remove a
  host** and **Accept a new host key** is chosen in a list of the hosts created
  in Gladys. A host not created yet is typed in the new **Or the host name**
  field; a name in the host field is still accepted. A host chosen in the list
  and a different one typed is refused, never guessed.

## [1.0.0] - 2026-10-17

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

[Unreleased]: https://github.com/guim31/gladys-ssh/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/guim31/gladys-ssh/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/guim31/gladys-ssh/releases/tag/v1.0.0
