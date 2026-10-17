// -----------------------------------------------------------------------------
// The standard figures, parsed from real outputs of STANDARD_COMMAND: Alpine
// with BusyBox (linuxserver/openssh-server), Ubuntu with GNU coreutils, and an
// old kernel without MemAvailable. Custom sensor outputs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNumber, parseStandard, parseText } from '../src/metrics.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/metrics/${name}`, import.meta.url), 'utf8');

test('Alpine / BusyBox', () => {
  assert.deepEqual(parseStandard(fixture('alpine-busybox.txt')), {
    load: 1.77,
    uptimeDays: 8.95,
    memory: 64.3,
    disk: 81.6,
  });
});

test('Ubuntu / GNU coreutils', () => {
  const result = parseStandard(fixture('ubuntu-gnu.txt'));
  assert.equal(result.load, 2.44);
  assert.equal(result.uptimeDays, 8.95);
  assert.equal(result.memory, 64.2);
  assert.equal(result.disk, 81.6);
});

test('an old kernel without MemAvailable: free + buffers + cache', () => {
  assert.deepEqual(parseStandard(fixture('old-kernel.txt')), {
    load: 0.08,
    uptimeDays: 0.04,
    memory: 53.2,
    disk: 31.5,
  });
});

test('a missing tool loses its figure only', () => {
  assert.deepEqual(parseStandard('LOAD 0.50 0.40 0.30 1/2 3\nUPTIME \nDISK \n'), {
    load: 0.5,
    uptimeDays: null,
    memory: null,
    disk: null,
  });
  assert.deepEqual(parseStandard(''), { load: null, uptimeDays: null, memory: null, disk: null });
});

test('custom numbers and texts', () => {
  assert.equal(parseNumber('48250\n'), 48250);
  assert.equal(parseNumber("temp=47,8'C"), 47.8);
  assert.equal(parseNumber('-3.5 dB'), -3.5);
  assert.equal(parseNumber('no number'), null);
  assert.equal(parseText('  active\n'), 'active');
  assert.equal(parseText('a\nb\tc'), 'a b c');
  assert.equal(parseText('   '), null);
  assert.equal(parseText('x'.repeat(300)).length, 250);
});
