/**
 * Live integration tests for buckets/files and multiple sessions.
 *
 * These require a running SurrealDB v3 with the experimental `files`
 * capability enabled. They self-skip when no usable server is reachable
 * (mirroring the gating in cli.test.ts), so the unit suite stays green without
 * a server while still exercising the real wire protocol where one is present.
 *
 * The `files` capability is EXPERIMENTAL and is NOT covered by `--allow-all`;
 * it must be enabled explicitly. The cleanest way is via the environment
 * variable (the `--allow-experimental files` *flag* swallows the trailing
 * `memory` datastore positional, so prefer the env var):
 *
 *   # PowerShell
 *   $env:SURREAL_CAPS_ALLOW_EXPERIMENTAL='files'
 *   surreal start --bind 127.0.0.1:8203 --user root --pass root --allow-all memory
 *
 * `--allow-all` grants guest access, which the session tests rely on (a freshly
 * `newSession()`ed session starts UNAUTHENTICATED).
 *
 * Point the tests at your server with env vars (defaults in parentheses):
 *   SURQL_TEST_HOST (127.0.0.1)  SURQL_TEST_PORT (8000)
 *   SURQL_TEST_USER (root)       SURQL_TEST_PASS (root)
 *   SURQL_TEST_NS   (main)       SURQL_TEST_DB   (main)
 *   SURQL_TEST_PROTOCOL (ws)
 */

import { assert, assertEquals } from '@std/assert'
import { afterAll, beforeAll, describe, it } from '@std/testing/bdd'
import { SurQLClient } from '../client.ts'
import type { ConnectionConfig } from '../auth/connection.ts'
import { FileRef, isFileRefLike, toFileRef } from '../types/file.ts'

const env = (key: string, fallback: string): string => Deno.env.get(key) ?? fallback

const config: ConnectionConfig = {
  host: env('SURQL_TEST_HOST', '127.0.0.1'),
  port: env('SURQL_TEST_PORT', '8000'),
  namespace: env('SURQL_TEST_NS', 'main'),
  database: env('SURQL_TEST_DB', 'main'),
  username: env('SURQL_TEST_USER', 'root'),
  password: env('SURQL_TEST_PASS', 'root'),
  protocol: env('SURQL_TEST_PROTOCOL', 'ws') as ConnectionConfig['protocol'],
}

/**
 * Probe a fully authenticated connection that can run a trivial query. Returns
 * a connected client or `undefined` when no usable server is present (port
 * closed, auth rejected, or files capability missing).
 */
async function tryClient(): Promise<SurQLClient | undefined> {
  const client = new SurQLClient(config)
  try {
    const db = await client.getConnection()
    await db.query('RETURN 1')
    return client
  } catch {
    await client.close().catch(() => {})
    return undefined
  }
}

let client: SurQLClient | undefined
let filesSupported = false
const BUCKET = `surql_test_${Date.now()}`

beforeAll(async () => {
  client = await tryClient()
  if (!client) return
  try {
    const db = await client.getConnection()
    await db.query(`DEFINE BUCKET ${BUCKET} BACKEND "memory"`)
    filesSupported = true
  } catch {
    // The files capability is not enabled on this server — skip file tests.
    filesSupported = false
  }
})

afterAll(async () => {
  if (client) {
    try {
      const db = await client.getConnection()
      await db.query(`REMOVE BUCKET IF EXISTS ${BUCKET}`)
    } catch {
      // best-effort cleanup
    }
    await client.close().catch(() => {})
  }
})

describe('Integration: bucket file round-trip (live)', () => {
  it('put/getText round-trips text', async () => {
    if (!client || !filesSupported) return
    const bucket = client.bucket(BUCKET)
    await bucket.put('hello.txt', 'hello world')
    assertEquals(await bucket.getText('hello.txt'), 'hello world')
  })

  it('put/get round-trips bytes', async () => {
    if (!client || !filesSupported) return
    const bucket = client.bucket(BUCKET)
    const payload = new Uint8Array([1, 2, 3, 4, 5])
    await bucket.put('blob.bin', payload)
    const out = await bucket.get('blob.bin')
    assertEquals(out, payload)
  })

  it('a key written with and without a leading slash resolves to one file', async () => {
    if (!client || !filesSupported) return
    const bucket = client.bucket(BUCKET)
    await bucket.put('slashy.txt', 'first')
    // The server normalises keys: "/slashy.txt" and "slashy.txt" are the same file.
    assertEquals(await bucket.getText('/slashy.txt'), 'first')
    await bucket.put('/slashy.txt', 'second')
    assertEquals(await bucket.getText('slashy.txt'), 'second')
  })

  it('exists reflects presence', async () => {
    if (!client || !filesSupported) return
    const bucket = client.bucket(BUCKET)
    await bucket.put('present.txt', 'x')
    assertEquals(await bucket.exists('present.txt'), true)
    assertEquals(await bucket.exists('absent.txt'), false)
  })

  it('copy duplicates a file to a target key', async () => {
    if (!client || !filesSupported) return
    const bucket = client.bucket(BUCKET)
    await bucket.put('orig.txt', 'data')
    await bucket.copy('orig.txt', 'copy.txt')
    assertEquals(await bucket.getText('copy.txt'), 'data')
    assertEquals(await bucket.exists('orig.txt'), true)
  })

  it('rename moves a file to a target key', async () => {
    if (!client || !filesSupported) return
    const bucket = client.bucket(BUCKET)
    await bucket.put('movable.txt', 'data')
    await bucket.rename('movable.txt', 'moved.txt')
    assertEquals(await bucket.getText('moved.txt'), 'data')
    assertEquals(await bucket.exists('movable.txt'), false)
  })

  it('delete removes a file', async () => {
    if (!client || !filesSupported) return
    const bucket = client.bucket(BUCKET)
    await bucket.put('temp.txt', 'x')
    await bucket.delete('temp.txt')
    assertEquals(await bucket.exists('temp.txt'), false)
  })

  it('head returns metadata with a canonical (leading-slash) key', async () => {
    if (!client || !filesSupported) return
    const bucket = client.bucket(BUCKET)
    await bucket.put('headed.txt', 'abc')
    const meta = await bucket.head('headed.txt')
    assert(meta)
    assertEquals(meta?.bucket, BUCKET)
    // SurrealDB exposes the canonical key form with a leading slash.
    assertEquals(meta?.key, '/headed.txt')
    assertEquals(meta?.size, 3)
  })

  it('list returns entries with canonical keys', async () => {
    if (!client || !filesSupported) return
    const bucket = client.bucket(BUCKET)
    await bucket.put('listed.txt', 'content')
    const entries = await bucket.list()
    const found = entries.find((e) => e.key === '/listed.txt')
    assert(found, `expected a /listed.txt entry, got: ${JSON.stringify(entries.map((e) => e.key))}`)
    assertEquals(found?.bucket, BUCKET)
  })

  it('list honours a prefix filter', async () => {
    if (!client || !filesSupported) return
    const bucket = client.bucket(BUCKET)
    await bucket.put('pfx/one.txt', '1')
    await bucket.put('pfx/two.txt', '2')
    const entries = await bucket.list({ prefix: '/pfx/' })
    assert(entries.length >= 2)
    assert(entries.every((e) => e.key.startsWith('/pfx/')))
  })
})

describe('Integration: FileRef decoding via record field (live)', () => {
  it('round-trips a file value stored in a record field', async () => {
    if (!client || !filesSupported) return
    const bucket = client.bucket(BUCKET)
    await bucket.put('doc.txt', 'hi')
    const db = await client.getConnection()
    // Store a file pointer in a normal record field, then read it back. The npm
    // SDK decodes the CBOR file tag into its own FileRef, so the field comes
    // back as a {bucket,key} carrier rather than an opaque value.
    const created = await db.query<[Array<{ ref: unknown }>]>(
      'CREATE ONLY doc_holder:test SET ref = type::file($bucket, $key) RETURN ref',
      { bucket: BUCKET, key: 'doc.txt' },
    )
    const row = Array.isArray(created) ? created[0] : undefined
    const refValue = Array.isArray(row) ? row[0]?.ref : (row as { ref?: unknown } | undefined)?.ref
    assert(isFileRefLike(refValue), `field did not decode to a file carrier: ${JSON.stringify(refValue)}`)
    const ref = toFileRef(refValue)
    assert(ref instanceof FileRef)
    assertEquals(ref?.bucket, BUCKET)
    assertEquals(ref?.key, '/doc.txt')
    assertEquals(ref?.toString(), `${BUCKET}:/doc.txt`)
    await db.query('DELETE doc_holder:test')
  })
})

describe('Integration: multiple sessions (live)', () => {
  it('opens a session, runs a query, and closes it', async () => {
    if (!client) return
    // Seed a row via the authenticated client so the table exists: SurrealDB v3
    // errors on SELECT from a wholly undefined table, and a freshly opened
    // session is unauthenticated (read-only guest under --allow-all), so it
    // cannot create the table itself.
    const table = `sess_probe_${Date.now()}`
    const seed = await client.getConnection()
    await seed.query(`CREATE ${table}:row SET ok = true`)
    const session = await client.newSession()
    try {
      await session.use({ namespace: 'main', database: 'main' })
      // The session runs as an unauthenticated guest, so it may see zero rows
      // even though the table exists; the contract under test is that the query
      // executes through the session and yields a well-formed array result.
      const rows = await session.query(table).execute()
      assert(Array.isArray(rows))
    } finally {
      await session.closeSession()
      assertEquals(session.isValid, false)
    }
  })

  it('forks a session', async () => {
    if (!client) return
    const session = await client.newSession()
    try {
      const forked = await session.forkSession()
      assert(forked.isValid)
      await forked.closeSession()
    } finally {
      await session.closeSession()
    }
  })
})
