import { NativeLocalCredentialProvider } from '../../src/backend.ts'
import { credentialKey } from '@deepseek-ai/dsh-credentials/native'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment/native'

type Role = 'holder' | 'contender'

function send(message: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.send === undefined) {
      reject(new Error('migration worker has no parent IPC channel'))
      return
    }
    process.send(message, (error) => {
      if (error === null) resolve()
      else reject(error)
    })
  })
}

function waitForRelease(): Promise<void> {
  return new Promise((resolve) => {
    const receive = (message: unknown): void => {
      if (message === null || typeof message !== 'object' || (message as { type?: unknown }).type !== 'release') return
      process.off('message', receive)
      resolve()
    }
    process.on('message', receive)
  })
}

async function run(): Promise<void> {
  const role = process.argv[2] as Role
  const filename = process.argv[3]!
  const candidate = process.argv[4]!
  const key = credentialKey('llm-pi-ai', 'openai-codex-siwc-registration')
  const unrelatedKey = credentialKey('other-owner', 'unrelated-record')
  const provider = new NativeLocalCredentialProvider({
    environment: () => createLaunchEnvironmentSnapshot([]),
    logger: { info() {}, warn() {}, error() {} },
    referenceUpdated() {},
  }, { path: filename, watch: false })
  await provider.start()
  try {
    const migration = provider.migrateRecordToMetadata(key, async (current) => {
      if (role === 'holder') {
        const released = waitForRelease()
        await send({ type: 'entered', role })
        await released
      }
      const value = current ?? { extAgentHostId: candidate }
      return { value, retireRecord: true }
    })
    if (role === 'contender') await send({ type: 'attempting', role })
    await migration
    const metadata = await provider.readMetadata(key)
    const legacyRetired = await provider.readRecord(key) === undefined
    const unrelatedRecordPreserved = await provider.readRecord(unrelatedKey) !== undefined
    const hostId = metadata !== null && typeof metadata === 'object'
      ? (metadata as { extAgentHostId?: unknown }).extAgentHostId
      : undefined
    await send({ type: 'completed', role, hostId, legacyRetired, unrelatedRecordPreserved })
  } finally {
    await provider.dispose()
    if (process.connected) process.disconnect()
  }
}

void run().catch(async (error: unknown) => {
  try { await send({ type: 'error', message: error instanceof Error ? error.message : String(error) }) } finally {
    process.exitCode = 1
    if (process.connected) process.disconnect()
  }
})
