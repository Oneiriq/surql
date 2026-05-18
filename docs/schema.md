# Schema Definition

surql provides a functional, composable schema builder for SurrealDB. Schemas are defined in TypeScript and used to generate migration SQL.

## Tables

### Basic Table

```typescript
import { tableSchema, TableMode } from 'jsr:@oneiriq/surql'

const users = tableSchema('users', TableMode.SCHEMAFULL)
```

`TableMode` options:

| Mode | Description |
|------|-------------|
| `SCHEMAFULL` | Only defined fields allowed |
| `SCHEMALESS` | Any fields allowed (default) |

### Add Fields

```typescript
import {
  withFields,
  stringField,
  intField,
  floatField,
  boolField,
  datetimeField,
  arrayField,
  objectField,
  recordField,
} from 'jsr:@oneiriq/surql'

const users = withFields(
  tableSchema('users', TableMode.SCHEMAFULL),
  stringField('name'),
  stringField('email'),
  intField('age'),
  boolField('active'),
  datetimeField('created_at'),
  stringField('bio', { optional: true }),
)
```

### Field Types

| Function | SurrealDB Type | Description |
|----------|----------------|-------------|
| `stringField(name)` | `string` | UTF-8 string |
| `intField(name)` | `int` | Integer |
| `floatField(name)` | `float` | Floating point |
| `boolField(name)` | `bool` | Boolean |
| `datetimeField(name)` | `datetime` | ISO 8601 datetime |
| `arrayField(name)` | `array` | Array of values |
| `objectField(name)` | `object` | Arbitrary object |
| `recordField(name, table)` | `record<table>` | Record reference |

Every field builder accepts an options object as its last argument. Pass
`{ optional: true }` to emit the type wrapped as `option<...>` — e.g.
`stringField('bio', { optional: true })` produces
`DEFINE FIELD bio ... TYPE option<string>` — so a `SCHEMAFULL` column accepts
the absence of a value.

### Indexes

```typescript
import { withIndexes, index } from 'jsr:@oneiriq/surql'

const users = withIndexes(
  withFields(tableSchema('users'), stringField('email')),
  index('email_idx', 'email', { unique: true }),
  index('name_idx', 'name'),
)
```

For MTREE vector indexes:

```typescript
import { mtreeIndex } from 'jsr:@oneiriq/surql'

const articles = withIndexes(
  withFields(tableSchema('articles'), arrayField('embedding')),
  mtreeIndex('embedding_idx', 'embedding', { dimensions: 1536 }),
)
```

### Permissions

```typescript
import { withPermissions } from 'jsr:@oneiriq/surql'

const posts = withPermissions(
  tableSchema('posts'),
  {
    select: 'WHERE published = true OR author = $auth.id',
    create: 'WHERE $auth.id != NONE',
    update: 'WHERE author = $auth.id',
    delete: 'WHERE author = $auth.id',
  },
)
```

### Events

```typescript
import { withEvents, event } from 'jsr:@oneiriq/surql'

const orders = withEvents(
  tableSchema('orders'),
  event('on_create', 'CREATE', 'RETURN $value'),
)
```

## Edges

Edges define graph relationships between tables.

```typescript
import {
  edgeSchema,
  EdgeMode,
  withFromTable,
  withToTable,
  typedEdge,
} from 'jsr:@oneiriq/surql'

// Relation edge
const authored = typedEdge('authored', 'users', 'posts')

// Or step by step
const likes = withToTable(
  withFromTable(edgeSchema('likes', EdgeMode.RELATION), 'users'),
  'posts',
)
```

## Schema Composition

```typescript
import type { SchemaDefinition } from 'jsr:@oneiriq/surql'

const schema: SchemaDefinition = {
  tables: [users, posts],
  edges: [authored, likes],
}
```

## Schema Diffing

Generate diffs between two schema states:

```typescript
import { diffTables } from 'jsr:@oneiriq/surql'

// diffTables compares two arrays of TableDefinition — the current
// schema and the target schema.
const diffs = diffTables([], [users, posts])
// Returns: SchemaDiff[]
```

## Schema Validation

```typescript
import { validateSchema } from 'jsr:@oneiriq/surql'

const result = validateSchema(schema)
// result.valid: boolean
// result.issues: { level: 'error' | 'warning', message: string }[]
```

## Schema Introspection

Inspect a live SurrealDB database:

```typescript
import { introspectSchema } from 'jsr:@oneiriq/surql'

const liveSchema = await introspectSchema(client)
```

## Next Steps

- [Migrations](migrations.md) - Apply schema changes
- [Visualization](visualization.md) - Generate diagrams from schemas
