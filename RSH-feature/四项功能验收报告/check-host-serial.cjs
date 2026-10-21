const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = process.argv[2];
const ts = require(path.join(root, 'node_modules/typescript'));
const output = path.join(__dirname, 'tool-groups-host-serial.log');
const configs = [];
const visited = new Set();
function visit(file) {
  file = path.resolve(file);
  if (fs.statSync(file).isDirectory()) file = path.join(file, 'tsconfig.json');
  if (visited.has(file)) return;
  visited.add(file);
  const read = ts.readConfigFile(file, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  for (const ref of read.config.references || []) visit(path.resolve(path.dirname(file), ref.path));
  configs.push(file);
}
visit(path.join(root, 'tsconfig.host.json'));
fs.writeFileSync(output, `Started ${new Date().toISOString()}\nRoot ${root}\nProjects ${configs.length}\n`);
for (const [index, file] of configs.entries()) {
  const label = `${index + 1}/${configs.length} ${path.relative(root, file)}`;
  const result = spawnSync(process.execPath, ['--max-old-space-size=1536', path.join(root, 'node_modules/typescript/bin/tsc'), '-b', file, '--pretty', 'false'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180000 });
  fs.appendFileSync(output, `\n${label}\n${result.stdout || ''}${result.stderr || ''}\nEXIT ${result.status}\n`);
  if (result.status !== 0) { console.log(`FAILED ${label}\n${result.stdout || ''}\n${result.stderr || ''}`); process.exit(1); }
  if ((index + 1) % 20 === 0 || index === configs.length - 1) console.log(`PASSED ${label}`);
}
fs.appendFileSync(output, `Completed ${new Date().toISOString()}\n`);
console.log(`All ${configs.length} project builds passed. ${output}`);
