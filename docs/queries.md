# Query Builder

surql provides a composable, type-safe query builder for SurrealDB.

## Basic Query

```typescript
import { SurQLClient } from 'jsr:@oneiriq/surql'
import { RecordId } from 'surrealdb'

interface User {
  id: RecordId
  name: string
  email: string
  age: number
}

const client = new SurQLClient(config)

// Select all
const users = await client.query<User>('users').execute()

// Get first
const first = await client.query<User>('users').first()
```

## Filtering

### Object-style WHERE

```typescript
const active = await client.query<User>('users')
  .where({ active: true, role: 'admin' })
  .execute()
```

### Fluent WHERE with operators

```typescript
import { Op } from 'jsr:@oneiriq/surql'

const adults = await client.query<User>('users')
  .where('age', Op.GREATER_THAN, 18)
  .where('name', Op.LIKE, '%alice%')
  .execute()
```

### Convenience methods

```typescript
const results = await client.query<User>('users')
  .whereEquals('status', 'active')
  .whereContains('tags', 'premium')
  .whereLike('email', '%@company.com')
  .execute()
```

## Sorting

```typescript
import { SortDirection } from 'jsr:@oneiriq/surql'

const sorted = await client.query<User>('users')
  .orderBy('created_at', SortDirection.DESC)
  .orderBy('name', SortDirection.ASC)
  .execute()
```

## Pagination

```typescript
// Limit and offset
const page = await client.query<User>('users')
  .limit(25)
  .offset(50)
  .execute()

// Page-based
const page2 = await client.query<User>('users')
  .page(2, 25)  // page 2, 25 per page
  .execute()
```

## Field Selection

```typescript
const partial = await client.query<User>('users')
  .select('name', 'email')
  .execute()
```

## Aggregations

```typescript
const stats = await client.query('orders')
  .groupBy('status')
  .count()
  .sum('total')
  .avg('total')
  .min('total')
  .max('total')
  .execute()
```

## HAVING

```typescript
const highValue = await client.query('orders')
  .groupBy('customer_id')
  .sum('total')
  .count()
  .having('SUM(total)', Op.GREATER_THAN, 1000)
  .having('COUNT(*)', Op.GREATER_THAN, 5)
  .execute()
```

## Type Mapping

Transform raw SurrealDB types to your domain types:

```typescript
interface UserRaw {
  id: RecordId
  name: string
  created_at: Date
}

interface UserDto {
  id: string
  name: string
  createdAt: string
}

const mapUser = (raw: UserRaw): UserDto => ({
  id: raw.id.toString(),
  name: raw.name,
  createdAt: raw.created_at.toISOString(),
})

const users = await client.query<UserRaw, UserDto>('users')
  .map(mapUser)
  .execute()
```

## CRUD Operations

### Create

```typescript
const user = await client.create<User>('users', {
  name: 'Alice',
  email: 'alice@example.com',
  age: 30,
}).execute()
```

### Create with custom ID

```typescript
const user = await client.create<User>('users', {
  name: 'Bob',
  email: 'bob@example.com',
  age: 25,
}).withId('users:bob').execute()
```

### Update (replace)

```typescript
await client.update<User>('users', new RecordId('users', 'alice'), {
  name: 'Alice Updated',
  email: 'alice@example.com',
  age: 31,
}).execute()
```

### Merge (partial update)

```typescript
await client.merge<User>('users', new RecordId('users', 'alice'), {
  age: 32,
}).execute()
```

### Upsert

```typescript
await client.upsert<User>('users', {
  name: 'Carol',
  email: 'carol@example.com',
  age: 28,
}).execute()
```

### JSON Patch (RFC 6902)

```typescript
await client.patch<User>('users', new RecordId('users', 'alice'), [
  { op: 'replace', path: '/age', value: 33 },
  { op: 'add', path: '/verified', value: true },
]).execute()
```

### Delete

```typescript
await client.remove<User>('users', new RecordId('users', 'alice')).execute()
```

## Raw Queries

Access the underlying connection for raw SurrealQL:

```typescript
const db = await client.getConnection()
const result = await db.query('SELECT * FROM users WHERE age > $age', { age: 18 })
```

## Error Handling

```typescript
try {
  const users = await client.query<User>('users').execute()
} catch (error) {
  if (error instanceof SurQLError) {
    console.error('Query error:', error.message)
  }
}
```

## Next Steps

- [Query Hints](query_hints.md) - Performance hints and warnings control
- [Caching](caching.md) - Cache query results
- [Streaming](streaming.md) - Live query subscriptions
