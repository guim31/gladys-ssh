// -----------------------------------------------------------------------------
// The standard figures of a Linux host, read in ONE command (one channel per
// cycle): load average, uptime, memory and the disk of `/`. Only /proc and a
// POSIX `df`: GNU coreutils and BusyBox (Alpine, OpenWrt, most NAS) both do.
// Each line carries a marker, so a missing tool loses its figure only.
// -----------------------------------------------------------------------------

export const STANDARD_COMMAND = [
  'echo "LOAD $(cat /proc/loadavg)"',
  'echo "UPTIME $(cat /proc/uptime)"',
  "grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached):' /proc/meminfo",
  'echo "DISK $(df -kP / | tail -n 1)"',
].join('; ');

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * @param {string} output stdout of STANDARD_COMMAND
 * @returns {{load: number|null, uptimeDays: number|null, memory: number|null, disk: number|null}}
 */
export function parseStandard(output) {
  const text = String(output ?? '');
  const result = { load: null, uptimeDays: null, memory: null, disk: null };

  const load = /^LOAD (\d+(?:\.\d+)?) /m.exec(text);
  if (load) {
    result.load = round(Number(load[1]), 2);
  }

  const uptime = /^UPTIME (\d+(?:\.\d+)?)/m.exec(text);
  if (uptime) {
    result.uptimeDays = round(Number(uptime[1]) / 86400, 2);
  }

  const mem = {};
  for (const match of text.matchAll(/^(\w+):\s+(\d+) kB$/gm)) {
    mem[match[1]] = Number(match[2]);
  }
  if (mem.MemTotal > 0) {
    // MemAvailable since Linux 3.14; older kernels: free + buffers + cache.
    const available =
      mem.MemAvailable ??
      (mem.MemFree !== undefined ? mem.MemFree + (mem.Buffers ?? 0) + (mem.Cached ?? 0) : null);
    if (available !== null) {
      result.memory = round(Math.min(100, Math.max(0, (1 - available / mem.MemTotal) * 100)), 1);
    }
  }

  // "DISK <filesystem> <1024-blocks> <used> <available> <capacity>% <mount>"
  const disk = /^DISK .*?\s(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+\S+\s*$/m.exec(text);
  if (disk) {
    const used = Number(disk[2]);
    const available = Number(disk[3]);
    // Same rounding as df (used / (used + available), reserved blocks apart),
    // with one decimal.
    result.disk =
      used + available > 0 ? round((used / (used + available)) * 100, 1) : Number(disk[4]);
  }
  return result;
}

/**
 * Reads a number in the output of a custom sensor: the first number of the
 * text, a decimal comma accepted ("42,5 °C" → 42.5). null when there is none.
 */
export function parseNumber(output) {
  const match = /-?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?/.exec(String(output ?? ''));
  if (!match) {
    return null;
  }
  const value = Number(match[0].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export const MAX_TEXT_LENGTH = 250;

/** The text of a custom sensor: its output on one line, trimmed, capped. null when empty. */
export function parseText(output) {
  const text = String(output ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    return null;
  }
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…` : text;
}
