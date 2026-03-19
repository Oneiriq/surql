# surql

**Code-first database toolkit for SurrealDB — TypeScript edition.**

surql provides a seamless developer experience for working with SurrealDB in TypeScript. Define schemas, manage migrations, build type-safe queries, and perform CRUD operations using a fluent, composable API. Available for both Deno and Node.js.

## Key Features

- **Fluent Builder API** - Chainable methods for complex data operations with zero abstraction overhead
- **Type Safety** - Full TypeScript generics and strict typing throughout
- **Multi-Runtime Support** - Works with both Deno (JSR) and Node.js (npm)
- **Schema Definition** - Code-first schema building with fields, indexes, edges, and permissions
- **Code-First Migrations** - Generate, apply, and roll back schema migrations in TypeScript
- **Vector Search** - MTREE index support with distance metrics and similarity scoring
- **Graph Traversal** - Native support for SurrealDB's graph features and edge relationships
- **Schema Visualization** - Generate Mermaid, GraphViz, and ASCII diagrams
- **Live Queries / Streaming** - Real-time change notifications
- **Multi-Database Orchestration** - Deploy migrations across multiple environments
- **Aggregations & Pagination** - `count()`, `sum()`, `avg()`, `min()`, `max()`, `page()`, `groupBy()`, `having()`
- **Authentication** - Root, Namespace, Database, and Scope-level auth with JWT lifecycle management
- **Caching** - Built-in query result caching with TTL and invalidation

## Quick Start

### Installation

=== "Deno (JSR)"

    ```typescript
    import { SurQLClient } from 'jsr:@oneiriq/surql'
    ```

    Or with an import map in `deno.json`:

    ```json
    {
      "imports": {
        "surql": "jsr:@oneiriq/surql"
      }
    }
    ```

=== "Node.js (npm)"

    ```shell
    npm install @oneiriq/surql
    ```

    ```typescript
    import { SurQLClient } from '@oneiriq/surql'
    ```

### Connect and Query

```typescript
import { SurQLClient } from 'jsr:@oneiriq/surql'
import { RecordId } from 'surrealdb'

interface User {
  id: RecordId
  name: string
  email: string
}

const client = new SurQLClient({
  host: 'localhost',
  port: '8000',
  namespace: 'myapp',
  database: 'production',
  username: 'root',
  password: 'root',
})

// Query with filter
const users = await client.query<User>('users')
  .where({ active: true })
  .limit(10)
  .execute()

// Create a record
const newUser = await client.create<User>('users', {
  name: 'Alice',
  email: 'alice@example.com',
})
.execute()

await client.close()
```

## Requirements

- Deno 2.x or Node.js 18+
- SurrealDB 2.0+

## License

MIT License
