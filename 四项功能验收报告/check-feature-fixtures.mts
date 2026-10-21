import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { parseSnapshotManifest, assertSessionFixtureVersion, redactSessionSnapshotIds, scrubSystemPrompts, scrubToolSchemas } from '../../RedSparkHarness-image-understanding/rsh/Tests/test-support/session-snapshot/src/index.ts'

for (const [root, name] of [
  ['E:/redsparkHarness/RedSparkHarness-image-understanding', 'image-understanding'],
  ['E:/redsparkHarness/RedSparkHarness-tool-groups', 'tool-groups'],
]) {
  const dir = join(root!, 'snapshots/native-headless', name!)
  const manifest = parseSnapshotManifest(readFileSync(join(dir, 'snapshot.yml'), 'utf8'), join(dir, 'snapshot.yml'))
  assert.equal(manifest.header.pin, true)
  const raw = readFileSync(join(dir, 'session.v3.jsonl'), 'utf8')
  assertSessionFixtureVersion('session.v3.jsonl', raw)
  assert.deepEqual(redactSessionSnapshotIds([raw]), [raw])
  assert.equal(scrubSystemPrompts(raw), raw)
  assert.equal(scrubToolSchemas(raw), raw)
  for (const file of ['system-prompt.expected.md', 'tool-schemas.expected.json']) assert.ok(existsSync(join(dir, file)))
  console.log(`${name}: manifest, version, identity normalization and header sidecars passed`)
}
