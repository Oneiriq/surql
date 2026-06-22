import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import type { Surreal } from 'surrealdb'
import { Bucket } from '../files/bucket.ts'
import type { ConnectionProvider } from '../crud/base.ts'

interface Captured {
  sql: string
  vars: Record<string, unknown>
}

/**
 * A connection provider that records every `query(sql, vars)` call and returns
 * a scripted result, so the exact SurrealQL and bound variables can be asserted
 * without a server.
 */
function capturingProvider(result: unknown = [undefined]): { provider: ConnectionProvider; calls: Captured[] } {
  const calls: Captured[] = []
  const provider: ConnectionProvider = {
    getConnection: () =>
      Promise.resolve(
        {
          query: (sql: string, vars: Record<string, unknown> = {}) => {
            calls.push({ sql, vars })
            return Promise.resolve(result)
          },
        } as unknown as Surreal,
      ),
  }
  return { provider, calls }
}

describe('Bucket parameterized SurrealQL + binding (safety)', () => {
  it('put binds $bucket/$key/$data and never interpolates them', async () => {
    const { provider, calls } = capturingProvider([null])
    await new Bucket(provider, 'assets').put('logo.png', 'hello')
    assertEquals(calls.length, 1)
    assertEquals(calls[0].sql, 'RETURN type::file($bucket, $key).put($data)')
    assertEquals(calls[0].vars, { bucket: 'assets', key: 'logo.png', data: 'hello' })
    // The payload/key must NOT appear inline in the statement.
    assert(!calls[0].sql.includes('logo.png'))
    assert(!calls[0].sql.includes('hello'))
  })

  it('a malicious key/data cannot break out of its bound position', async () => {
    const { provider, calls } = capturingProvider([null])
    const evilKey = "x'); REMOVE TABLE users; --"
    const evilData = "'; DEFINE USER hacker; --"
    await new Bucket(provider, 'b').put(evilKey, evilData)
    // Statement is the fixed template; the injection lives purely in vars.
    assertEquals(calls[0].sql, 'RETURN type::file($bucket, $key).put($data)')
    assertEquals(calls[0].vars.key, evilKey)
    assertEquals(calls[0].vars.data, evilData)
    assert(!calls[0].sql.includes('REMOVE TABLE'))
  })

  it('putIfNotExists uses put_if_not_exists', async () => {
    const { provider, calls } = capturingProvider([null])
    await new Bucket(provider, 'b').putIfNotExists('k', 'd')
    assertEquals(calls[0].sql, 'RETURN type::file($bucket, $key).put_if_not_exists($data)')
  })

  it('binds a Uint8Array payload directly', async () => {
    const { provider, calls } = capturingProvider([null])
    const bytes = new Uint8Array([1, 2, 3])
    await new Bucket(provider, 'b').put('k', bytes)
    assertEquals(calls[0].vars.data, bytes)
    assert(calls[0].vars.data instanceof Uint8Array)
  })

  it('get returns bytes and uses type::file().get()', async () => {
    const { provider, calls } = capturingProvider([new Uint8Array([65, 66])])
    const out = await new Bucket(provider, 'b').get('k')
    assertEquals(calls[0].sql, 'RETURN type::file($bucket, $key).get()')
    assertEquals(out, new Uint8Array([65, 66]))
  })

  it('get decodes a string body into bytes', async () => {
    const { provider } = capturingProvider(['AB'])
    assertEquals(await new Bucket(provider, 'b').get('k'), new TextEncoder().encode('AB'))
  })

  it('get returns undefined when the file is missing', async () => {
    const { provider } = capturingProvider([null])
    assertEquals(await new Bucket(provider, 'b').get('k'), undefined)
  })

  it('getText casts the result to <string>', async () => {
    const { provider, calls } = capturingProvider(['hello'])
    const text = await new Bucket(provider, 'b').getText('k')
    assertEquals(calls[0].sql, 'RETURN <string>type::file($bucket, $key).get()')
    assertEquals(text, 'hello')
  })

  it('exists returns a boolean', async () => {
    const t = capturingProvider([true])
    assertEquals(await new Bucket(t.provider, 'b').exists('k'), true)
    assertEquals(t.calls[0].sql, 'RETURN type::file($bucket, $key).exists()')
    const f = capturingProvider([false])
    assertEquals(await new Bucket(f.provider, 'b').exists('k'), false)
  })

  it('head uses .head() and splits the decoded file pointer into canonical bucket/key', async () => {
    // The driver decodes the row's `file` pointer into a {bucket,key} carrier
    // whose key carries SurrealDB's canonical leading slash.
    const { provider, calls } = capturingProvider([{
      file: { bucket: 'b', key: '/k' },
      size: 3,
      updated: '2025-01-01',
    }])
    const meta = await new Bucket(provider, 'b').head('k')
    assertEquals(calls[0].sql, 'RETURN type::file($bucket, $key).head()')
    assertEquals(meta?.size, 3)
    assertEquals(meta?.bucket, 'b')
    assertEquals(meta?.key, '/k')
    assertEquals(meta?.file.toString(), 'b:/k')
  })

  it('head returns undefined when the file is missing', async () => {
    const { provider } = capturingProvider([null])
    assertEquals(await new Bucket(provider, 'b').head('k'), undefined)
  })

  it('delete uses .delete()', async () => {
    const { provider, calls } = capturingProvider([null])
    await new Bucket(provider, 'b').delete('k')
    assertEquals(calls[0].sql, 'RETURN type::file($bucket, $key).delete()')
  })

  it('copy binds $target', async () => {
    const { provider, calls } = capturingProvider([null])
    await new Bucket(provider, 'b').copy('src', 'dst')
    assertEquals(calls[0].sql, 'RETURN type::file($bucket, $key).copy($target)')
    assertEquals(calls[0].vars, { bucket: 'b', key: 'src', target: 'dst' })
  })

  it('copyIfNotExists uses copy_if_not_exists', async () => {
    const { provider, calls } = capturingProvider([null])
    await new Bucket(provider, 'b').copyIfNotExists('src', 'dst')
    assertEquals(calls[0].sql, 'RETURN type::file($bucket, $key).copy_if_not_exists($target)')
  })

  it('rename binds $target', async () => {
    const { provider, calls } = capturingProvider([null])
    await new Bucket(provider, 'b').rename('src', 'dst')
    assertEquals(calls[0].sql, 'RETURN type::file($bucket, $key).rename($target)')
    assertEquals(calls[0].vars.target, 'dst')
  })

  it('renameIfNotExists uses rename_if_not_exists', async () => {
    const { provider, calls } = capturingProvider([null])
    await new Bucket(provider, 'b').renameIfNotExists('src', 'dst')
    assertEquals(calls[0].sql, 'RETURN type::file($bucket, $key).rename_if_not_exists($target)')
  })

  it('list with no options uses the bucket-level file::list($bucket)', async () => {
    const { provider, calls } = capturingProvider([[]])
    await new Bucket(provider, 'b').list()
    assertEquals(calls[0].sql, 'RETURN file::list($bucket)')
    assertEquals(calls[0].vars, { bucket: 'b' })
  })

  it('list with options binds $options', async () => {
    const { provider, calls } = capturingProvider([[]])
    await new Bucket(provider, 'b').list({ prefix: 'img/', limit: 10 })
    assertEquals(calls[0].sql, 'RETURN file::list($bucket, $options)')
    assertEquals(calls[0].vars.options, { prefix: 'img/', limit: 10 })
  })

  it('list normalises rows to canonical {bucket,key,file,size,updated} entries', async () => {
    const row = { file: { bucket: 'b', key: '/k' }, size: 1, updated: '2025-01-01' }
    const { provider } = capturingProvider([[row]])
    const entries = await new Bucket(provider, 'b').list()
    assertEquals(entries.length, 1)
    assertEquals(entries[0].bucket, 'b')
    assertEquals(entries[0].key, '/k')
    assertEquals(entries[0].file.toString(), 'b:/k')
    assertEquals(entries[0].size, 1)
    assertEquals(entries[0].updated, '2025-01-01')
  })

  it('list drops rows whose file is not a recognisable pointer', async () => {
    const { provider } = capturingProvider([[{ size: 1, updated: 'x' }, null, 'junk']])
    assertEquals(await new Bucket(provider, 'b').list(), [])
  })

  it('ref builds a FileRef for a key', () => {
    const { provider } = capturingProvider()
    assertEquals(new Bucket(provider, 'b').ref('k').toString(), 'b:/k')
  })

  it('rejects an empty bucket name', () => {
    const { provider } = capturingProvider()
    let threw = false
    try {
      new Bucket(provider, '')
    } catch {
      threw = true
    }
    assert(threw)
  })

  it('wraps a query failure in a SurQL error', async () => {
    const provider: ConnectionProvider = {
      getConnection: () =>
        Promise.resolve(
          { query: () => Promise.reject(new Error('boom')) } as unknown as Surreal,
        ),
    }
    let message = ''
    try {
      await new Bucket(provider, 'b').get('k')
    } catch (e) {
      message = e instanceof Error ? e.message : String(e)
    }
    assertStringIncludes(message, "Bucket operation failed on 'b'")
  })
})
