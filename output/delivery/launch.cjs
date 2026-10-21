const { spawn, execFile } = require('node:child_process');
const { resolve, join } = require('node:path');
const { existsSync, writeFileSync } = require('node:fs');
const root = resolve(__dirname, '../..');
const offline = process.argv.includes('--offline');
const home = join(root, 'output/playwright', offline ? 'feature01-delivery-offline' : 'feature01-connected-home');
if (!existsSync(join(home, 'profiles/native-web/rsh.profile.json'))) {
  console.error('Profile missing: ' + home);
  process.exit(1);
}
console.log(offline ? 'RedSpark Studio - OFFLINE verification (no image recognition)' : 'RedSpark Studio - configured model profile');
console.log('Starting the real application. Keep this window open; Ctrl+C stops the service.');
const child = spawn(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-web'], {
  cwd: root, env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
});
let buffer = '';
let opened = false;
child.stdout.on('data', chunk => {
  if (opened) return;
  buffer += chunk.toString();
  const match = buffer.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/);
  if (!match) return;
  opened = true;
  writeFileSync(join(home, 'runtime-url.txt'), match[0]);
  console.log('Application ready: ' + new URL(match[0]).origin);
  execFile('powershell.exe', ['-NoProfile', '-Command', 'Start-Process -FilePath $env:RSH_STUDIO_URL'], {
    env: { ...process.env, RSH_STUDIO_URL: match[0] },
  }, error => {
    if (error) console.error('Browser did not open. Restart this launcher to retry.');
  });
});
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill());
