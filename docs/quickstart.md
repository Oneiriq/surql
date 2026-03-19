# Quick Start

This tutorial walks through connecting to SurrealDB, defining schemas, creating migrations, and performing CRUD operations.

## Prerequisites

- Deno 2.x or Node.js 18+
- SurrealDB running locally (see [Installation](installation.md))
- surql installed or imported

## 1. Setup Connection

```typescript
import { SurQLClient } from 'jsr:@oneiriq/surql'
import { RecordId } from 'surrealdb'

const client = new SurQLClient({
  host: 'localhost',
  port: '8000',
  namespace: 'myapp',
  database: 'dev',
  username: 'root',
  password: 'root',
})
```

## 2. Define Types

```typescript
interface User {
  id: RecordId
  name: string
  email: string
  age: number
}

interface Post {
  id: RecordId
  title: string
  content: string
  author: RecordId
  published: boolean
}
```

## 3. Define a Schema

```typescript
import {
  stringField,
  intField,
  boolField,
  recordField,
} from 'jsr:@oneiriq/surql'
import { tableSchema, withFields, withIndexes, index } from 'jsr:@oneiriq/surql'
import { TableMode } from 'jsr:@oneiriq/surql'

const userSchema = withIndexes(
  withFields(
    tableSchema('users', TableMode.SCHEMAFULL),
    stringField('name'),
    stringField('email'),
    intField('age'),
  ),
  index('email_idx', 'email', { unique: true }),
)

const postSchema = withFields(
  tableSchema('posts', TableMode.SCHEMAFULL),
  stringField('title'),
  stringField('content'),
  recordField('author', 'users'),
  boolField('published'),
)
```

## 4. Generate a Migration

```typescript
import { generateMigrationFromDiffs, diffSchemas } from 'jsr:@oneiriq/surql'

const diffs = diffSchemas({ tables: [] }, { tables: [userSchema, postSchema] })
const migration = generateMigrationFromDiffs(diffs, 'create_users_posts')

console.log(migration.upSql)
console.log(migration.downSql)
```

## 5. Apply the Migration

```typescript
import { MigrationRunner } from 'jsr:@oneiriq/surql'

const runner = new MigrationRunner(client, [
  {
    version: '20240101000001',
    description: 'create_users_posts',
    up: async () => migration.upSql,
    down: async () => migration.downSql,
  },
])

await runner.up()
```

## 6. CRUD Operations

### Create

```typescript
const user = await client.create<User>('users', {
  name: 'Alice',
  email: 'alice@example.com',
  age: 30,
}).execute()
```

### Query

```typescript
// All records
const users = await client.query<User>('users').execute()

// With filter
const adults = await client.query<User>('users')
  .where({ age: 30 })
  .execute()

// With limit and ordering
const top10 = await client.query<User>('users')
  .orderBy('name')
  .limit(10)
  .execute()
```

### Update

```typescript
import { RecordId } from 'surrealdb'

await client.update<User>('users', new RecordId('users', 'alice'), {
  name: 'Alice Smith',
  email: 'alice.smith@example.com',
  age: 31,
}).execute()
```

### Merge (partial update)

```typescript
await client.merge<User>('users', new RecordId('users', 'alice'), {
  age: 32,
}).execute()
```

### Delete

```typescript
await client.remove<User>('users', new RecordId('users', 'alice')).execute()
```

## 7. Aggregations

```typescript
const stats = await client.query('orders')
  .groupBy('status')
  .count()
  .sum('total')
  .avg('total')
  .execute()
```

## Next Steps

- [Schema Definition](schema.md) - Complete schema builder reference
- [Migrations](migrations.md) - Migration lifecycle management
- [Query Builder](queries.md) - Advanced query patterns
- [Orchestration](orchestration.md) - Multi-environment deployments
