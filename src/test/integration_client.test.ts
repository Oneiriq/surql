import { assert, assertEquals, assertRejects } from '@std/assert'
import { afterAll, afterEach, beforeAll, describe, it } from '@std/testing/bdd'
import { RecordId } from 'surrealdb'
import { SurQLClient } from '../client.ts'
import { deployToEnvironments, MigrationCoordinator } from '../orchestration/coordinator.ts'
import { DeploymentStatus } from '../orchestration/strategy.ts'
import type { EnvironmentConfig } from '../orchestration/config.ts'
import type { Migration } from '../migration/models.ts'

// ---------------------------------------------------------------------------
// Shared connection config pointing at local SurrealDB
// ---------------------------------------------------------------------------

const NS = 'test'
const TEST_DB = `test_integ_client_${Date.now()}`

const CONNECTION_CONFIG = {
  host: 'localhost',
  port: '8000',
  namespace: NS,
  database: TEST_DB,
  username: 'root',
  password: 'root',
}

// ---------------------------------------------------------------------------
// SurQLClient integration tests
// ---------------------------------------------------------------------------

interface UserRecord {
  id: RecordId
  name: string
  age: number
}

let client: SurQLClient

beforeAll(async () => {
  // Bootstrap the test database using raw connection
  const { Surreal } = await import('surrealdb')
  const bootstrap = new Surreal()
  await bootstrap.connect('http://localhost:8000/rpc')
  await bootstrap.signin({ username: 'root', password: 'root' })
  await bootstrap.query(`DEFINE NAMESPACE IF NOT EXISTS ${NS}`)
  await bootstrap.use({ namespace: NS })
  await bootstrap.query(`DEFINE DATABASE IF NOT EXISTS \`${TEST_DB}\``)
  await bootstrap.close()

  client = new SurQLClient(CONNECTION_CONFIG)
})

afterAll(async () => {
  try {
    const db = await client.getConnection()
    await db.query(`REMOVE DATABASE IF EXISTS \`${TEST_DB}\``)
  } catch {
    // best-effort
  }
  await client.close()
})

async function cleanTable(table: string): Promise<void> {
  try {
    const db = await client.getConnection()
    await db.query(`DELETE ${table}`)
  } catch {
    // table may not exist
  }
}

// ---------------------------------------------------------------------------
// client.create()
// ---------------------------------------------------------------------------

describe('SurQLClient: create()', () => {
  afterEach(async () => {
    await cleanTable('sc_users')
  })

  it('should create a record and return it', async () => {
    const result = await client.create<UserRecord>('sc_users', { name: 'Alice', age: 30 }).execute()
    assert(result !== null && result !== undefined)
    const records = Array.isArray(result) ? result : [result]
    assertEquals(records[0].name, 'Alice')
    assertEquals(records[0].age, 30)
  })

  it('should create records in the specified table', async () => {
    await client.create<UserRecord>('sc_users', { name: 'Bob', age: 25 }).execute()
    await client.create<UserRecord>('sc_users', { name: 'Carol', age: 35 }).execute()
    const results = await client.query<UserRecord>('sc_users').execute()
    assertEquals(results.length, 2)
  })
})

// ---------------------------------------------------------------------------
// client.query()
// ---------------------------------------------------------------------------

describe('SurQLClient: query()', () => {
  afterEach(async () => {
    await cleanTable('sq_users')
  })

  it('should query and return all records from a table', async () => {
    const db = await client.getConnection()
    await db.query(`CREATE sq_users:a1 SET name = 'Alice', age = 30`)
    await db.query(`CREATE sq_users:b1 SET name = 'Bob', age = 25`)

    const results = await client.query<UserRecord>('sq_users').execute()
    assertEquals(results.length, 2)
  })

  it('should support where() object style filter', async () => {
    const db = await client.getConnection()
    await db.query(`CREATE sq_users:c1 SET name = 'Alice', age = 30`)
    await db.query(`CREATE sq_users:c2 SET name = 'Bob', age = 25`)

    const results = await client.query<UserRecord>('sq_users').where({ name: 'Alice' }).execute()
    assertEquals(results.length, 1)
    assertEquals(results[0].name, 'Alice')
  })

  it('should support limit() on query', async () => {
    const db = await client.getConnection()
    for (let i = 0; i < 5; i++) {
      await db.query(`CREATE sq_users SET name = 'User${i}', age = ${20 + i}`)
    }

    const results = await client.query<UserRecord>('sq_users').limit(2).execute()
    assertEquals(results.length, 2)
  })

  it('should return empty array when no records match', async () => {
    const results = await client.query<UserRecord>('sq_users').where({ name: 'Nonexistent' }).execute()
    assertEquals(results.length, 0)
  })
})

// ---------------------------------------------------------------------------
// client.update()
// ---------------------------------------------------------------------------

describe('SurQLClient: update()', () => {
  afterEach(async () => {
    await cleanTable('su_users')
  })

  it('should update a record by id', async () => {
    const db = await client.getConnection()
    await db.query(`CREATE su_users:u1 SET name = 'Alice', age = 30`)

    await client.update<UserRecord>('su_users', new RecordId('su_users', 'u1'), { name: 'Alice Updated', age: 31 })
      .execute()

    const results = await client.query<UserRecord>('su_users').where({ name: 'Alice Updated' }).execute()
    assertEquals(results.length, 1)
    assertEquals(results[0].age, 31)
  })
})

// ---------------------------------------------------------------------------
// client.remove()
// ---------------------------------------------------------------------------

describe('SurQLClient: remove()', () => {
  afterEach(async () => {
    await cleanTable('sr_users')
  })

  it('should remove a record by id (DeleteQL throws because SurrealDB DELETE returns null)', async () => {
    const db = await client.getConnection()
    await db.query(`CREATE sr_users:d1 SET name = 'Alice', age = 30`)

    // SurrealDB DELETE returns null (no RETURN BEFORE), so DeleteQL.execute() throws after deletion
    await assertRejects(
      () => client.remove<UserRecord>('sr_users', new RecordId('sr_users', 'd1')).execute(),
    )

    // The record was still deleted despite the thrown error
    const results = await client.query<UserRecord>('sr_users').execute()
    assertEquals(results.length, 0)
  })
})

// ---------------------------------------------------------------------------
// client.merge()
// ---------------------------------------------------------------------------

describe('SurQLClient: merge()', () => {
  afterEach(async () => {
    await cleanTable('sm_users')
  })

  it('should merge fields into an existing record', async () => {
    const db = await client.getConnection()
    await db.query(`CREATE sm_users:m1 SET name = 'Alice', age = 30`)

    await client.merge<UserRecord>('sm_users', new RecordId('sm_users', 'm1'), { age: 31 }).execute()

    const results = await client.query<UserRecord>('sm_users').execute()
    assertEquals(results[0].name, 'Alice')
    assertEquals(results[0].age, 31)
  })
})

// ---------------------------------------------------------------------------
// client.upsert()
// ---------------------------------------------------------------------------

describe('SurQLClient: upsert()', () => {
  afterEach(async () => {
    await cleanTable('sups_users')
  })

  it('should create a record when it does not exist', async () => {
    await client.upsert<UserRecord>('sups_users', { name: 'Diana', age: 28 }).execute()

    const results = await client.query<UserRecord>('sups_users').execute()
    assertEquals(results.length, 1)
    assertEquals(results[0].name, 'Diana')
  })
})

// ---------------------------------------------------------------------------
// client.patch()
// ---------------------------------------------------------------------------

describe('SurQLClient: patch()', () => {
  afterEach(async () => {
    await cleanTable('sp_users')
  })

  it('should apply replace patch operation to a record', async () => {
    const db = await client.getConnection()
    await db.query(`CREATE sp_users:p1 SET name = 'Alice', age = 30`)

    await client.patch<UserRecord>('sp_users', new RecordId('sp_users', 'p1'), [
      { op: 'replace', path: '/age', value: 99 },
    ]).execute()

    const results = await client.query<UserRecord>('sp_users').execute()
    assertEquals(results[0].age, 99)
  })
})

// ---------------------------------------------------------------------------
// MigrationCoordinator integration tests
// ---------------------------------------------------------------------------

describe('MigrationCoordinator: checkHealth()', () => {
  it('should report healthy for a reachable SurrealDB instance', async () => {
    const env: EnvironmentConfig = {
      name: 'local',
      connection: {
        host: 'localhost',
        port: '8000',
        namespace: NS,
        database: TEST_DB,
        username: 'root',
        password: 'root',
      },
    }

    const coordinator = new MigrationCoordinator([])
    const statuses = await coordinator.checkHealth([env])

    assertEquals(statuses.length, 1)
    assertEquals(statuses[0].environment, 'local')
    assertEquals(statuses[0].healthy, true)
    assert(statuses[0].latencyMs >= 0)
  })

  it('should report unhealthy for an unreachable host', async () => {
    const env: EnvironmentConfig = {
      name: 'unreachable',
      connection: {
        host: '127.0.0.1',
        port: '19999',
        namespace: NS,
        database: TEST_DB,
        username: 'root',
        password: 'root',
      },
    }

    const coordinator = new MigrationCoordinator([])
    const statuses = await coordinator.checkHealth([env])

    assertEquals(statuses.length, 1)
    assertEquals(statuses[0].healthy, false)
    assert(typeof statuses[0].error === 'string')
  })
})

describe('MigrationCoordinator: deploy() with sequential strategy', () => {
  const MCOORD_DB = `test_mcoord_${Date.now()}`

  const localEnv: EnvironmentConfig = {
    name: 'local',
    connection: {
      host: 'localhost',
      port: '8000',
      namespace: NS,
      database: MCOORD_DB,
      username: 'root',
      password: 'root',
    },
  }

  beforeAll(async () => {
    const { Surreal } = await import('surrealdb')
    const boot = new Surreal()
    await boot.connect('http://localhost:8000/rpc')
    await boot.signin({ username: 'root', password: 'root' })
    await boot.use({ namespace: NS })
    await boot.query(`DEFINE DATABASE IF NOT EXISTS \`${MCOORD_DB}\``)
    await boot.close()
  })

  afterAll(async () => {
    const { Surreal } = await import('surrealdb')
    const boot = new Surreal()
    await boot.connect('http://localhost:8000/rpc')
    await boot.signin({ username: 'root', password: 'root' })
    await boot.use({ namespace: NS })
    await boot.query(`REMOVE DATABASE IF EXISTS \`${MCOORD_DB}\``)
    await boot.close()
  })

  it('should deploy migrations sequentially and return results', async () => {
    const migration: Migration = {
      version: '20240101000001',
      description: 'create_test_table',
      up: async () => 'DEFINE TABLE coord_test SCHEMAFULL;',
      down: async () => 'REMOVE TABLE coord_test;',
    }

    const coordinator = new MigrationCoordinator([migration])
    const results = await coordinator.deploy({
      environments: [localEnv],
      migrations: [migration],
      strategy: 'sequential',
    })

    assertEquals(results.length, 1)
    assertEquals(results[0].environment, 'local')
    assertEquals(results[0].status, DeploymentStatus.SUCCESS)
  })

  it('should deploy via deployToEnvironments standalone function', async () => {
    const migration: Migration = {
      version: '20240101000002',
      description: 'create_another_table',
      up: async () => 'DEFINE TABLE coord_test2 SCHEMAFULL;',
      down: async () => 'REMOVE TABLE coord_test2;',
    }

    const results = await deployToEnvironments({
      environments: [localEnv],
      migrations: [migration],
      strategy: 'sequential',
    })

    assertEquals(results.length, 1)
    assertEquals(results[0].status, DeploymentStatus.SUCCESS)
  })
})
