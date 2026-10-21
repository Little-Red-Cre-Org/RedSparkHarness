#!/usr/bin/env node
/**
 * Pull one Node image, retrying only the observed Docker Hub token-header timeout.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RETRY_DELAY_MS = 1_000;

/**
 * @typedef {{ exitCode: number, stderr: string }} PullResult
 */

/**
 * Invoke a command while streaming its output and retaining stderr for classification.
 * @param {string} command Executable to invoke.
 * @param {string[]} args Arguments passed without shell interpolation.
 * @returns {Promise<PullResult>} The process exit code and captured stderr.
 */
function runCommand(command, args) {
  return new Promise((resolveResult) => {
    let stderr = '';
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      resolveResult(result);
    };

    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'pipe'] });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.once('error', (error) => {
      const diagnostic = error.message + '\n';
      process.stderr.write(diagnostic);
      finish({ exitCode: 1, stderr: stderr + diagnostic });
    });
    child.once('close', (code) => {
      finish({ exitCode: code ?? 1, stderr });
    });
  });
}

/**
 * @param {number} milliseconds Delay before the single permitted retry.
 * @returns {Promise<void>}
 */
function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

/**
 * Pulls an image with one retry for Docker Hub auth-token header transport timeouts.
 * @param {string} image Docker image reference to pull.
 * @param {{
 *   runCommand?: (command: string, args: string[]) => Promise<PullResult>,
 *   wait?: (milliseconds: number) => Promise<void>,
 * }} [options] Process and delay seams used by the host-side regression test.
 * @returns {Promise<number>} The final docker pull exit code.
 */
export async function pullNodeImage(image, options = {}) {
  const invoke = options.runCommand ?? runCommand;
  const pause = options.wait ?? wait;
  const pull = () => invoke('docker', ['pull', image]);
  const first = await pull();

  if (
    first.exitCode === 0
    || !first.stderr.includes('auth.docker.io/token')
    || !first.stderr.includes('Client.Timeout exceeded while awaiting headers')
  ) {
    return first.exitCode;
  }

  await pause(RETRY_DELAY_MS);
  const retry = await pull();
  return retry.exitCode;
}

const scriptPath = process.argv[1];
if (scriptPath && resolve(scriptPath) === fileURLToPath(import.meta.url)) {
  const image = process.argv[2];
  if (!image || process.argv.length !== 3) {
    console.error('Usage: node scripts/pull-node-image.mjs <image>');
    process.exitCode = 2;
  } else {
    process.exitCode = await pullNodeImage(image);
  }
}