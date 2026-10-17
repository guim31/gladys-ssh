// -----------------------------------------------------------------------------
// Scene action (manifest `scene_actions`, Gladys 5.1+): run_command.
//
// Runs one command DECLARED in the configuration, named by the scene; the name
// may come from a scene variable, but it only ever selects a declared command,
// never adds to its text. Outputs: success (1/0, the core's "Continue only if"
// compares numbers, never booleans), exit code (-1: not run, or stopped at its
// timeout) and output (1000 characters at most).
//
// A failing command does not fail the scene action: the outputs say it, and
// the `command_failed` trigger fires. An unknown host or command does (the
// scene is wrong, the log of the scene says why).
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async run_command(monitor, { fields }) {
    const host = monitor.hostOfDevice(fields.device);
    const command = monitor.requireCommand(host, fields.command);
    const result = await monitor.runCommand(host, command, 'scene');
    return {
      success: result.success ? 1 : 0,
      exit_code: result.code,
      output: result.output,
    };
  },
};
