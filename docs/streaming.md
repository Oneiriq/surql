# Streaming / Live Queries

surql supports SurrealDB's live query feature for real-time data subscriptions.

## Basic Live Query

```typescript
import { SurQLClient } from 'jsr:@oneiriq/surql'

const client = new SurQLClient(config)
const db = await client.getConnection()

// Subscribe to live changes on a table
const uuid = await db.live('users', (action, result) => {
  console.log('Action:', action)   // 'CREATE' | 'UPDATE' | 'DELETE'
  console.log('Record:', result)
})

// Unsubscribe when done
await db.kill(uuid)
```

## Filtered Live Queries

Use raw SurrealQL for filtered subscriptions:

```typescript
const db = await client.getConnection()

await db.query(`
  LIVE SELECT * FROM users WHERE active = true
`)
```

## Stream Processing

```typescript
import { toTransformStream } from '@std/streams'

// Process live events as a stream
const stream = await client.stream<User>('users')

for await (const event of stream) {
  console.log(event.action, event.record)
}
```

## Batch Subscriptions

```typescript
const db = await client.getConnection()

// Subscribe to multiple tables
const uuids = await Promise.all([
  db.live('users', handleUserChange),
  db.live('posts', handlePostChange),
])

// Cleanup
await Promise.all(uuids.map((uuid) => db.kill(uuid)))
```

## Error Handling

```typescript
try {
  const uuid = await db.live('users', (action, result) => {
    if (action === 'CREATE') {
      processNewUser(result)
    }
  })
} catch (error) {
  console.error('Failed to start live query:', error)
}
```

## Next Steps

- [Orchestration](orchestration.md) - Deploy migrations across environments
