/** Private C/C++ task child, with isolated compilation and inherited interactive terminal. */
export const cRunner = String.raw`
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, dirname, isAbsolute, delimiter } = require('node:path');
const [file, compiler, missingCompiler] = process.argv.slice(2);
const env = { ...process.env };
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
if (isAbsolute(compiler)) env[pathKey] = dirname(compiler) + delimiter + (env[pathKey] || '');
async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.once('error', error => {
      if (error.code === 'ENOENT') error.message = missingCompiler + '\n' + command;
      reject(error);
    });
    child.once('exit', code => resolve(code === null ? 1 : code));
  });
}
(async () => {
  const output = await mkdtemp(join(tmpdir(), 'rsh-cc-'));
  try {
    const binary = join(output, process.platform === 'win32' ? 'program.exe' : 'program');
    const compiled = await run(compiler, ['-finput-charset=UTF-8', '-fexec-charset=UTF-8', file, '-o', binary]);
    process.exitCode = compiled === 0 ? await run(binary, []) : compiled;
  } finally {
    await rm(output, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
`
