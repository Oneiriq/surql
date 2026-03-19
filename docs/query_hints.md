# Query Hints

surql provides optional query hints to control warnings and logging behavior.

## Warnings Control

By default, surql may emit advisory warnings when queries are executed without explicit type mappings. Use the `warnings` hint to control this behavior.

```typescript
// Suppress all warnings for this query
const results = await client.query<User>('users', { warnings: 'suppress' })
  .execute()
```

### Warning Modes

| Mode | Description |
|------|-------------|
| `'suppress'` | Suppress all advisory warnings |
| `'log'` | Log warnings to console (default) |

## Usage with Create/Update

Hints apply to all query builder types:

```typescript
const user = await client.create<User>('users', data, { warnings: 'suppress' })
  .execute()

const updated = await client.update<User>('users', id, data, { warnings: 'suppress' })
  .execute()
```

## Type Mapping Warnings

When using the raw query builder without `.map()`, surql warns that raw SurrealDB types (like `RecordId` and `Date`) may be returned:

```typescript
// Warning emitted: "Consider using .map() for type transformation"
const raw = await client.query<UserRaw>('users').execute()

// No warning — explicit raw mode
const raw = await client.query<UserRaw>('users', { warnings: 'suppress' }).execute()

// No warning — mapper provided
const mapped = await client.query<UserRaw, UserDto>('users')
  .map(mapUser)
  .execute()
```

## Next Steps

- [Caching](caching.md) - Cache query results for performance
