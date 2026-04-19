import { assertEquals } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { watchSchema } from '../migration/watcher.ts'
import { createSnapshot, serializeSnapshot } from '../migration/versioning.ts'
import { tableSchema } from '../schema/table.ts'
import type { DriftReport } from '../migration/hooks.ts'

async function withTempDir(test: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: 'surql_watcher_test_' })
  try {
    await test(dir)
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
}

async function writeSnapshot(path: string, tableNames: string[]): Promise<void> {
  const snapshot = createSnapshot(
    '20260101000000',
    tableNames.map((n) => tableSchema(n)),
    [],
  )
  await Deno.writeTextFile(path, serializeSnapshot(snapshot))
}

function waitForReport(received: DriftReport[], timeoutMs = 3000): Promise<DriftReport | undefined> {
  return new Promise((resolve) => {
    const start = Date.now()
    const poll = () => {
      if (received.length > 0) return resolve(received[0])
      if (Date.now() - start >= timeoutMs) return resolve(undefined)
      setTimeout(poll, 25)
    }
    poll()
  })
}

describe('Schema watcher', () => {
  it('debounces events and invokes callback with a DriftReport', async () => {
    await withTempDir(async (root) => {
      const schemaDir = `${root}/schemas`
      await Deno.mkdir(schemaDir, { recursive: true })
      const snapshotPath = `${root}/snapshot.json`
      await writeSnapshot(snapshotPath, ['user'])

      const received: DriftReport[] = []
      const handle = await watchSchema(
        schemaDir,
        (report) => {
          received.push(report)
        },
        { snapshotPath, debounceMs: 100 },
      )

      try {
        // Give the watcher a tick to spin up its iterator.
        await new Promise((r) => setTimeout(r, 50))

        // Rapid writes within the debounce window should coalesce.
        await Deno.writeTextFile(`${schemaDir}/user.surql`, 'DEFINE TABLE user SCHEMAFULL;')
        await Deno.writeTextFile(`${schemaDir}/user.surql`, 'DEFINE TABLE user SCHEMAFULL;\n')

        const report = await waitForReport(received)
        assertEquals(report !== undefined, true)
        assertEquals(report!.passed, true)
      } finally {
        await handle.stop()
      }
    })
  })

  it('reports drift when a new table is introduced', async () => {
    await withTempDir(async (root) => {
      const schemaDir = `${root}/schemas`
      await Deno.mkdir(schemaDir, { recursive: true })
      const snapshotPath = `${root}/snapshot.json`
      await writeSnapshot(snapshotPath, ['user'])

      const received: DriftReport[] = []
      const handle = await watchSchema(
        schemaDir,
        (report) => {
          received.push(report)
        },
        { snapshotPath, debounceMs: 80 },
      )

      try {
        await new Promise((r) => setTimeout(r, 50))
        await Deno.writeTextFile(
          `${schemaDir}/extra.surql`,
          'DEFINE TABLE extra SCHEMAFULL;',
        )

        const report = await waitForReport(received)
        assertEquals(report !== undefined, true)
        assertEquals(report!.passed, false)
        assertEquals(report!.issues.some((i) => i.objectName === 'extra'), true)
      } finally {
        await handle.stop()
      }
    })
  })

  it('stop() halts future callbacks', async () => {
    await withTempDir(async (root) => {
      const schemaDir = `${root}/schemas`
      await Deno.mkdir(schemaDir, { recursive: true })
      const snapshotPath = `${root}/snapshot.json`
      await writeSnapshot(snapshotPath, [])

      const received: DriftReport[] = []
      const handle = await watchSchema(
        schemaDir,
        (report) => {
          received.push(report)
        },
        { snapshotPath, debounceMs: 50 },
      )

      await handle.stop()
      assertEquals(handle.stopped, true)

      await Deno.writeTextFile(`${schemaDir}/x.surql`, 'DEFINE TABLE x;')
      await new Promise((r) => setTimeout(r, 150))
      assertEquals(received.length, 0)
    })
  })

  it('supports AsyncDisposable via Symbol.asyncDispose', async () => {
    await withTempDir(async (root) => {
      const schemaDir = `${root}/schemas`
      await Deno.mkdir(schemaDir, { recursive: true })
      const snapshotPath = `${root}/snapshot.json`
      await writeSnapshot(snapshotPath, [])

      const handle = await watchSchema(
        schemaDir,
        () => {},
        { snapshotPath, debounceMs: 50 },
      )

      await handle[Symbol.asyncDispose]()
      assertEquals(handle.stopped, true)
    })
  })
})
