/** Private task child: compile into an isolated directory, then inherit the interactive terminal. */
export const javaRunner = String.raw`
const { spawn } = require('node:child_process');
const { mkdtemp, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, basename, delimiter, sep } = require('node:path');
const [file, java, javac, missingJdk] = process.argv.slice(2);
async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', error => {
      if (error.code === 'ENOENT') error.message = missingJdk + '\n' + command;
      reject(error);
    });
    child.once('exit', (code) => resolve(code === null ? 1 : code));
  });
}
(async () => {
  const output = await mkdtemp(join(tmpdir(), 'rsh-java-'));
  try {
    const compiled = await run(javac, ['-J-Dfile.encoding=UTF-8', '-encoding', 'UTF-8', '-d', output, file]);
    if (compiled !== 0) { process.exitCode = compiled; return; }
    const entries = await readdir(output, { recursive: true });
    const entry = entries.find(name => basename(name) === basename(file, '.java') + '.class');
    if (entry === undefined) throw new Error('No compiled entry class: ' + file);
    const name = entry.slice(0, -6).split(sep).join('.');
    process.exitCode = await run(java, ['-Dfile.encoding=UTF-8', '-cp', output + delimiter + process.cwd(), name]);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
`
