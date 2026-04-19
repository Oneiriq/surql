# Query UX

The v1.3.x query-UX wave fills in first-class helpers for the patterns callers were previously reaching into `raw()` / `surqlFn()` for. This page shows the before/after for each helper.

## `typeRecord` / `typeThing` references

`typeRecord(table, id?)` produces a `SurrealFnValue` that renders as `type::record('table:id')` (or `type::record('table')` when `id` is omitted). `typeThing` is a parity alias for surql-py / surql-rs / surql-go callers; both emit the v3-valid form.

**Before:**

```typescript
import { raw } from 'jsr:@oneiriq/surql'

await db.query(
  `UPDATE task:${taskId} SET owner = type::record('user:${userId}')`,
)
```

**After:**

```typescript
import { typeRecord, updateRecord } from 'jsr:@oneiriq/surql'

await updateRecord(db, typeRecord('task', taskId), {
  owner: typeRecord('user', userId),
})
```

The nested `typeRecord` call renders inline in the `SET` clause because `SurrealFnValue` carries the `__surqlFn` marker that `quoteValue()` recognises.

## Function factories

v1.3.0 expanded the function catalogue so callers can compose SurrealDB math / string / count / time functions from typed factories instead of raw strings.

### New factories

| Category | Factory | Emits |
| --- | --- | --- |
| Count | `count()`, `count(expr)` | `count()`, `count(expr)` |
| Count | `countIf(condition)` | `count(IF <cond> THEN 1 END)` |
| Math | `mathAbs`, `mathCeil`, `mathFloor`, `mathRound` | `math::abs`, `math::ceil`, `math::floor`, `math::round` |
| Math | `mathSum`, `mathMean`, `mathMax`, `mathMin` | `math::sum`, `math::mean`, `math::max`, `math::min` |
| String | `stringLen`, `stringLower`, `stringUpper`, `stringConcat` | `string::len`, `string::lowercase`, `string::uppercase`, `string::concat` |
| Time | `timeNow()`, `timeFormat(expr, format)` | `time::now()`, `time::format(expr, format)` |
| Array | `arrayLength`, `arrayContains`, `arrayDistinct`, `arrayFlatten` | `array::len`, `array::contains`, `array::distinct`, `array::flatten` |
| Record | `recordRef(table, id?)` | `type::record('table:id')` (expression form) |

Short-form aliases retained for pre-1.3.0 callers: `abs_`, `ceil`, `floor`, `round_`, `upper`, `lower`, `concat`, `stringLength`, `sum_`, `avg`, `min_`, `max_`.

### `countIf` example

**Before:**

```typescript
import { raw } from 'jsr:@oneiriq/surql'

const failing = raw('count(IF status = "failed" THEN 1 END)')
```

**After:**

```typescript
import { countIf } from 'jsr:@oneiriq/surql'

const failing = countIf('status = "failed"')
```

## `FunctionValueExpression` — one value, two contexts

Every factory above returns a `FunctionValueExpression`: it implements `FunctionExpression` **and** `SurrealFnValue`. The same value can be handed to `SELECT` / `WHERE` expression slots **and** to a `SET` field value without re-wrapping:

```typescript
import { createRecord, timeNow, updateRecord } from 'jsr:@oneiriq/surql'

// SET clause — renders inline as time::now() (not parameterised).
await createRecord(db, 'audit', { ts: timeNow(), action: 'login' })
await updateRecord(db, 'user', 'alice', { lastSeen: timeNow() })

// SELECT expression — same value, also valid here.
import { aggregateRecords, field } from 'jsr:@oneiriq/surql'

await aggregateRecords({
  table: 'request',
  select: { now: timeNow() },
  groupAll: true,
  client: db,
})
```

Previously you needed to reach for `surqlFn('time::now')` when you wanted the `SET`-clause form and for `func('time::now')` (or a `raw(...)`) when you wanted the expression form.

## `extractMany` and `hasResult` aliases

The result extraction helpers gained parity aliases with surql-py (`extract_many`, `has_result`):

```typescript
import { extractMany, hasResult } from 'jsr:@oneiriq/surql'

const raw = await db.query('SELECT * FROM user WHERE active = true')
const users = extractMany<User>(raw)

if (hasResult(raw)) {
  console.log(`found ${users.length} active users`)
}
```

`extractResult` and `hasResults` remain available; `extractMany` and `hasResult` are thin aliases so code ported from py/rs/go reads identically.

## `aggregateRecords`

One-shot aggregation helper. Pass named SELECT expressions keyed by the alias you want each column to use:

```typescript
import { aggregateRecords, count, countIf, mathSum } from 'jsr:@oneiriq/surql'

const counts = await aggregateRecords({
  table: 'memory_entry',
  select: {
    total: count(),
    failed: countIf('status = "failed"'),
    strengthSum: mathSum('strength'),
  },
  groupBy: ['network'],
  orderBy: [{ field: 'network', direction: 'ASC' }],
  client: db,
})

// counts[0] === { network: 'foo', total: 12, failed: 2, strengthSum: 48 }
```

Options:

| Field | Type | Notes |
| --- | --- | --- |
| `table` | `string` | Required. Escaped via `escapeTable()`. |
| `select` | `Record<string, Expression>` | Required. At least one alias → expression. |
| `groupBy` | `readonly string[]` | Mutually exclusive with `groupAll`. |
| `groupAll` | `boolean` | Emits `GROUP ALL`. Array is always a single row. |
| `where` | `string` | Raw predicate spliced after `WHERE`. |
| `orderBy` | `{ field, direction?: 'ASC' \| 'DESC' }[]` | Appended in order. |
| `limit` | `number` | Appended as `LIMIT n`. |
| `client` | `Surreal` | Active connection. |

Throws if `select` is empty or if both `groupAll` and `groupBy` are set.

## CRUD overloads: `updateRecord(db, ref, data)` / `getRecord(db, ref)`

`getRecord` and `updateRecord` now accept a `typeRecord()` reference in place of the `(table, id)` pair. The original signatures still work.

**Before:**

```typescript
import { getRecord, updateRecord } from 'jsr:@oneiriq/surql'

const task = await getRecord<Task>(db, 'task', taskId)
await updateRecord<Task>(db, 'task', taskId, { status: 'done' })
```

**After:**

```typescript
import { getRecord, typeRecord, updateRecord } from 'jsr:@oneiriq/surql'

const ref = typeRecord('task', taskId)
const task = await getRecord<Task>(db, ref)
await updateRecord<Task>(db, ref, { status: 'done' })
```

Useful when the reference already exists (e.g. returned by `aggregateRecords` or flowed through a domain-layer helper) — you no longer have to split it back into `(table, id)` at the call site.
