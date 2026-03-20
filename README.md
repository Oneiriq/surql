# surql

[![JSR Version](https://img.shields.io/jsr/v/@oneiriq/surql)](https://jsr.io/@oneiriq/surql)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![SurrealDB](https://img.shields.io/badge/SurrealDB-1.0%2B-ff00a0)](https://surrealdb.com/)

A type-safe query builder and client for [SurrealDB](https://surrealdb.com/). Build complex queries, manage connections, and perform typed CRUD all from TypeScript, available for both Deno and Node.js.

## Features

- **Fluent Query Builder** - Chainable API for SELECT, INSERT, UPDATE, DELETE with full TypeScript generics
- **Multi-Runtime** - Works with both Deno and Node.js (v18+) via JSR and NPM
- **Authentication** - Root, Namespace, Database, and Scope-level auth with JWT lifecycle management
- **Advanced CRUD** - Merge (partial update), JSON Patch (RFC 6902), and Upsert operations
- **Aggregations** - GROUP BY, HAVING, count/sum/avg/min/max with fluent syntax
- **Pagination** - limit/offset and page-based pagination
- **Type Utilities** - `Serialized<T>` and `createSerializer` for mapping raw SurrealDB types
- **Connection Management** - `SurrealConnectionManager` for pooling and `SurQLClient` for single connections
- **Input Sanitization** - Built-in injection prevention and rich error types
- **Zero Dependencies** - Minimal footprint, native Promise-based execution

## Quick Start

### Deno

```typescript
import { SurQLClient, query } from 'jsr:@oneiriq/surql'
```

Or via `deno.json` import map:

```json
{
  "imports": {
    "surql": "jsr:@oneiriq/surql"
  }
}
```

### Node.js

```bash
npm install @oneiriq/surql
```

```typescript
import { SurQLClient, query } from '@oneiriq/surql'
```

### Example

```typescript
import { SurQLClient, RecordId, Serialized, createSerializer } from 'surql'

interface User {
  id: RecordId
  username: string
  email: string
  created_at: Date
}

type SerializedUser = Serialized<User>

const serializer = createSerializer<User>()
const mapUser = (u: User): SerializedUser => ({
  id: serializer.id(u),
  username: u.username,
  email: u.email,
  created_at: serializer.date(u.created_at),
})

const client = new SurQLClient(config)
await client.signin({ type: 'root', username: 'root', password: 'password' })

const users = await client.query<User, SerializedUser>('users')
  .where({ active: true })
  .orderBy('username')
  .limit(10)
  .map(mapUser)
  .execute()
```

## Documentation

See the **[Changelog](./CHANGELOG.md)** for release history.

## Requirements

- Deno 1.40+ or Node.js 18+
- SurrealDB 1.0+

## License

MIT - see [LICENSE](LICENSE).

## Python

Looking for SurrealDB tooling in Python? Check out **[surql-py](https://github.com/Oneiriq/surql-py)** the code-first schema, migration, and query toolkit for SurrealDB built for Python 3.12+.

## Support

- Issues: [GitHub Issues](https://github.com/Oneiriq/surql/issues)
- Changelog: [CHANGELOG](CHANGELOG.md)
