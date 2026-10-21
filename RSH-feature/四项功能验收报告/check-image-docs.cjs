const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = 'E:/redsparkHarness/RedSparkHarness-image-understanding';
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
const log = path.join(root, 'output/playwright/logs/feature01-doc-remaining.log');
const names = ['doc-typecheck:contracts-ready', 'verify-doc-graphs', 'verify-cordis-catalog', 'verify-cordis-inspect-catalog', 'verify-mermaid', 'verify-scoped-events', 'verify-client-catalog', 'verify-tool-catalog', 'verify-config-catalog', 'verify-persistence-catalog', 'verify-session-format-catalog', 'verify-subsystem-pages', 'verify-package-paths', 'verify-tsconfig-paths', 'verify-config-source-ownership'];
fs.writeFileSync(log, `Started ${new Date().toISOString()}\nSerial remaining doc leaves; existing compiled declarations.\n`);
const results = [];
for (const name of names) {
  const args = scripts[name].split(' ');
  if (args.shift() !== 'tsx') throw new Error(`Unexpected script ${name}`);
  const result = spawnSync(process.execPath, ['--max-old-space-size=1536', '--import', 'tsx/esm', ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000,
    env: { ...process.env, DSH_DOC_TYPECHECK_USE_BUILD_OUTPUT: '1' },
  });
  fs.appendFileSync(log, `\n${name}\n${result.stdout || ''}${result.stderr || ''}\nEXIT ${result.status}\n`);
  results.push({ name, exit: result.status });
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${name}`);
}
fs.writeFileSync(log.replace('.log', '.json'), JSON.stringify(results, null, 2));
process.exitCode = results.some(result => result.exit !== 0) ? 1 : 0;
