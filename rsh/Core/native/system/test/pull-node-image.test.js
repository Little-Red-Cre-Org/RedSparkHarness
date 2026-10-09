import assert from 'node:assert/strict';
import test from 'node:test';
import { pullNodeImage } from '../scripts/pull-node-image.mjs';

const image = 'node:24-alpine';
const timeoutVariants = [
  'Get "https://auth.docker.io/token?scope=repository:library/node:pull": context deadline exceeded (Client.Timeout exceeded while awaiting headers)',
  'Get "https://auth.docker.io/token?scope=repository:library/node:pull": request canceled (Client.Timeout exceeded while awaiting headers)',
];

test('a successful pull invokes Docker once with the exact image', async () => {
  const calls = [];
  const waits = [];
  const exitCode = await pullNodeImage(image, {
    runCommand: async (command, args) => {
      calls.push([command, args]);
      return { exitCode: 0, stderr: '' };
    },
    wait: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [['docker', ['pull', image]]]);
  assert.deepEqual(waits, []);
});

test('both observed auth-token header timeouts retry once before succeeding', async () => {
  for (const diagnostic of timeoutVariants) {
    const calls = [];
    const waits = [];
    let attempt = 0;
    const exitCode = await pullNodeImage(image, {
      runCommand: async (command, args) => {
        calls.push([command, args]);
        attempt += 1;
        return attempt === 1
          ? { exitCode: 125, stderr: diagnostic }
          : { exitCode: 0, stderr: '' };
      },
      wait: async (milliseconds) => waits.push(milliseconds),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, [
      ['docker', ['pull', image]],
      ['docker', ['pull', image]],
    ]);
    assert.deepEqual(waits, [1_000]);
  }
});

test('a repeated auth-token header timeout fails after one retry', async () => {
  const calls = [];
  const waits = [];
  const exitCode = await pullNodeImage(image, {
    runCommand: async (command, args) => {
      calls.push([command, args]);
      return { exitCode: 125, stderr: timeoutVariants[0] };
    },
    wait: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(exitCode, 125);
  assert.deepEqual(calls, [
    ['docker', ['pull', image]],
    ['docker', ['pull', image]],
  ]);
  assert.deepEqual(waits, [1_000]);
});

test('other Docker pull failures fail on the first attempt', async () => {
  const failures = [
    { exitCode: 1, stderr: 'Get "https://auth.docker.io/token": unauthorized: authentication required' },
    { exitCode: 1, stderr: 'manifest for node:24-alpine not found: manifest unknown' },
    { exitCode: 1, stderr: 'no matching manifest for linux/arm64/v8' },
    { exitCode: 125, stderr: 'request canceled (Client.Timeout exceeded while awaiting headers)' },
  ];

  for (const failure of failures) {
    const calls = [];
    const waits = [];
    const exitCode = await pullNodeImage(image, {
      runCommand: async (command, args) => {
        calls.push([command, args]);
        return failure;
      },
      wait: async (milliseconds) => waits.push(milliseconds),
    });

    assert.equal(exitCode, failure.exitCode);
    assert.deepEqual(calls, [['docker', ['pull', image]]]);
    assert.deepEqual(waits, []);
  }
});