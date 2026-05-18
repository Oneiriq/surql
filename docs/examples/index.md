# Examples

Working code examples for common surql use cases.

## Basic CRUD

```typescript
import { SurQLClient } from 'jsr:@oneiriq/surql'
import { RecordId } from 'surrealdb'

interface Product {
  id: RecordId
  name: string
  price: number
  inStock: boolean
}

const client = new SurQLClient({
  host: 'localhost', port: '8000',
  namespace: 'shop', database: 'prod',
  username: 'root', password: 'root',
})

// Create
const product = await client.create<Product>('products', {
  name: 'Widget Pro',
  price: 29.99,
  inStock: true,
}).execute()

// Query with filter
const available = await client.query<Product>('products')
  .where({ inStock: true })
  .orderBy('price')
  .execute()

// Update
await client.merge<Product>(
  'products',
  new RecordId('products', product.id.id as string),
  { price: 24.99 },
).execute()

// Delete
await client.remove<Product>(
  'products',
  new RecordId('products', product.id.id as string),
).execute()

await client.close()
```

## Type Mapping

```typescript
import { SurQLClient, Serialized, createSerializer } from 'jsr:@oneiriq/surql'
import { RecordId } from 'surrealdb'

interface UserRaw {
  id: RecordId
  name: string
  createdAt: Date
}

type UserDto = Serialized<UserRaw>

const serializer = createSerializer<UserRaw>()

const users = await client.query<UserRaw, UserDto>('users')
  .map((raw) => ({
    id: serializer.id(raw),
    name: raw.name,
    createdAt: serializer.date(raw.createdAt),
  }))
  .execute()
```

## Schema with Migration

```typescript
import {
  diffTables,
  generateMigrationFromDiffs,
  intField,
  migrateUp,
  stringField,
  tableSchema,
  TableMode,
  uniqueIndex,
  withFields,
  withIndexes,
} from 'jsr:@oneiriq/surql'

// Define schema
const userSchema = withIndexes(
  withFields(
    tableSchema('users', TableMode.SCHEMAFULL),
    stringField('name'),
    stringField('email'),
    intField('age'),
  ),
  uniqueIndex('email_idx', 'email'),
)

// Generate a migration from a diff against an empty schema
const diffs = diffTables([], [userSchema])
const migration = generateMigrationFromDiffs(diffs, 'create_users')

// Apply migration — `db` is a connected Surreal connection
await migrateUp(db, [{
  version: '20240101000001',
  description: 'create_users',
  up: async () => migration.upSql,
  down: async () => migration.downSql,
}])
console.log('Migration applied')
```

## Aggregations

```typescript
interface SaleStats {
  region: string
  count: number
  total: number
  avg: number
}

const stats = await client.query<SaleStats>('sales')
  .groupBy('region')
  .count()
  .sum('amount')
  .avg('amount')
  .having('SUM(amount)', Op.GREATER_THAN, 10000)
  .orderBy('sum_amount', SortDirection.DESC)
  .execute()
```

## Multi-Environment Deployment

```typescript
import {
  MigrationCoordinator,
  deployToEnvironments,
  DeploymentStatus,
} from 'jsr:@oneiriq/surql'

const environments = [
  {
    name: 'staging',
    connection: {
      host: 'staging.db.internal', port: '8000',
      namespace: 'myapp', database: 'staging',
      username: 'admin', password: Deno.env.get('STAGING_PASS')!,
    },
  },
  {
    name: 'production',
    connection: {
      host: 'prod.db.internal', port: '8000',
      namespace: 'myapp', database: 'prod',
      username: 'admin', password: Deno.env.get('PROD_PASS')!,
    },
  },
]

const coordinator = new MigrationCoordinator([migration])
const results = await coordinator.deploy({
  environments,
  migrations: [migration],
  strategy: 'sequential',
})

for (const result of results) {
  if (result.status === DeploymentStatus.SUCCESS) {
    console.log(`${result.environment}: deployed`)
  } else {
    console.error(`${result.environment}: FAILED`, result.error)
  }
}
```

## Graph Queries

```typescript
// Traverse graph relationships using raw SurrealQL
const db = await client.getConnection()

// Get all posts authored by a user
const posts = await db.query(
  'SELECT * FROM users:alice->authored->posts'
)

// Get all users who liked a post
const likers = await db.query(
  'SELECT * FROM posts:article1<-likes<-users'
)
```

## Authentication

```typescript
const client = new SurQLClient(config)

// Root authentication
await client.signin({ type: 'root', username: 'root', password: 'root' })

// Scope authentication
await client.signin({
  type: 'scope',
  namespace: 'myapp',
  database: 'prod',
  scope: 'user',
  username: 'alice@example.com',
  password: 'secretpass',
})

if (client.isAuthenticated()) {
  const session = await client.info()
  console.log('Logged in as:', session)
}

await client.invalidate()
```

## Schema Visualization

```typescript
import { generateMermaid, generateAscii, validateSchema } from 'jsr:@oneiriq/surql'

const schema = { tables: [userSchema, postSchema], edges: [authoredEdge] }

// Validate
const validation = validateSchema(schema)
if (!validation.valid) {
  console.error(validation.issues)
}

// Mermaid diagram
const mermaid = generateMermaid(schema)
await Deno.writeTextFile('schema.mermaid', mermaid)

// ASCII for terminal
console.log(generateAscii(schema))
```

## More Examples

See the `examples/` directory in the repository for:

- `basicCrud.ts` - Basic CRUD operations
- `customMapping.ts` - Custom serialization
- `advancedMapping.ts` - Advanced type mapping patterns
- `customIdExample.ts` - Custom record IDs
- `userManagement.ts` - User management patterns
