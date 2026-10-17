# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes, in
particular:

- the command boundary: only the commands declared in the configuration may
  run, and nothing a scene or a widget request sends is added to them;
- the host key check (trust on first use, refusal of a changed key before
  authentication);
- the secrets kept in `/data`, the integration's private volume: its own SSH
  private key (`id_ed25519`, mode 600), and `state.json` (mode 600) with the
  hosts, their commands, the remembered host key fingerprints and the optional
  per-host passwords. The private key, passphrase and passwords must never
  appear in the logs, the action results or the device parameters;
- the SSH connections the integration opens to the machines you added, on
  your local network. It opens no port and talks to no other service.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the SSH servers of your machines, and what the commands you declared do once
run: grant the SSH user only what those commands need.
