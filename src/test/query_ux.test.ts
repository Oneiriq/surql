/**
 * Unit tests for the v1.3.0 query-UX feature wave (issue #29):
 * - typeRecord / typeThing helpers
 * - SurrealQL function factories (timeNow, math*, string*, count, countIf)
 * - extractMany / hasResult alias surface
 * - aggregateRecords builder-side surface
 */

import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { Surreal } from 'surrealdb'

import {
  aggregateRecords,
  count,
  countIf,
  extractMany,
  extractOne,
  extractScalar,
  field,
  hasResult,
  isSurqlFn,
  mathAbs,
  mathCeil,
  mathFloor,
  mathMax,
  mathMean,
  mathMin,
  mathRound,
  mathSum,
  select,
  stringConcat,
  stringLen,
  stringLower,
  stringUpper,
  surqlFn,
  timeNow,
  typeRecord,
  typeThing,
  updateQuery,
  updateRecord,
} from '../../mod.ts'
import { quoteValue } from '../query/helpers.ts'
import { resolveRecordTarget } from '../types/surqlFn.ts'

// ---------------------------------------------------------------------------
// Sub-feature #1: typeRecord / typeThing
// ---------------------------------------------------------------------------

describe('typeRecord / typeThing', () => {
  it('renders type::record(table:id)', () => {
    assertEquals(typeRecord('task', 'abc').toSurQL(), "type::record('task:abc')")
  })

  it('renders type::record(table) when id omitted', () => {
    assertEquals(typeRecord('task').toSurQL(), "type::record('task')")
  })

  it('typeThing is an alias for typeRecord', () => {
    assertEquals(typeThing('agent', '123').toSurQL(), "type::record('agent:123')")
  })

  it('is a SurrealFnValue', () => {
    const ref = typeRecord('task', 'abc')
    assertEquals(ref.__surqlFn, true)
    assertEquals(isSurqlFn(ref), true)
  })

  it('renders inline in SET clauses (not parameterized)', () => {
    const ref = typeRecord('user', 'alice')
    assertEquals(quoteValue(ref), "type::record('user:alice')")
  })

  it('rejects invalid identifiers', () => {
    assertThrows(() => typeRecord('bad name!'), Error)
  })

  it('resolveRecordTarget extracts table:id from a ref', () => {
    const ref = typeRecord('task', 'abc')
    assertEquals(resolveRecordTarget(ref), 'task:abc')
  })

  it('resolveRecordTarget passes through plain strings', () => {
    assertEquals(resolveRecordTarget('task:abc'), 'task:abc')
  })
})

// ---------------------------------------------------------------------------
// Sub-feature #2: function factories
// ---------------------------------------------------------------------------

describe('function factories: time', () => {
  it('timeNow() renders time::now()', () => {
    assertEquals(timeNow().toSurQL(), 'time::now()')
  })

  it('timeNow() is a SurrealFnValue usable in SET', () => {
    const fn = timeNow()
    assertEquals(fn.__surqlFn, true)
    assertEquals(quoteValue(fn), 'time::now()')
  })
})

describe('function factories: math', () => {
  it('mathMean accepts a field-name string', () => {
    assertEquals(mathMean('strength').toSurQL(), 'math::mean(strength)')
  })

  it('mathMean accepts an Expression', () => {
    assertEquals(mathMean(field('strength')).toSurQL(), 'math::mean(strength)')
  })

  it('mathSum / mathMin / mathMax render correctly', () => {
    assertEquals(mathSum('score').toSurQL(), 'math::sum(score)')
    assertEquals(mathMin('age').toSurQL(), 'math::min(age)')
    assertEquals(mathMax('age').toSurQL(), 'math::max(age)')
  })

  it('mathAbs / mathCeil / mathFloor / mathRound render correctly', () => {
    assertEquals(mathAbs('delta').toSurQL(), 'math::abs(delta)')
    assertEquals(mathCeil('n').toSurQL(), 'math::ceil(n)')
    assertEquals(mathFloor('n').toSurQL(), 'math::floor(n)')
    assertEquals(mathRound('n').toSurQL(), 'math::round(n)')
  })

  it('math factories are SurrealFnValues (usable in SET)', () => {
    assertEquals(quoteValue(mathCeil('val')), 'math::ceil(val)')
  })
})

describe('function factories: string', () => {
  it('stringLen / stringLower / stringUpper render correctly', () => {
    assertEquals(stringLen('name').toSurQL(), 'string::len(name)')
    assertEquals(stringLower('name').toSurQL(), 'string::lowercase(name)')
    assertEquals(stringUpper('name').toSurQL(), 'string::uppercase(name)')
  })

  it('stringConcat accepts mixed strings and expressions', () => {
    assertEquals(
      stringConcat('first_name', 'last_name').toSurQL(),
      'string::concat(first_name, last_name)',
    )
  })
})

describe('function factories: count / countIf', () => {
  it('count() renders count() row-count', () => {
    assertEquals(count().toSurQL(), 'count()')
  })

  it('count(field) renders count(expr)', () => {
    assertEquals(count('status').toSurQL(), 'count(status)')
  })

  it('countIf renders count(IF ... THEN 1 END)', () => {
    assertEquals(
      countIf('status = "active"').toSurQL(),
      'count(IF status = "active" THEN 1 END)',
    )
  })
})

describe('function factories in query building', () => {
  it('timeNow() flows through updateQuery.SET', () => {
    const sql = updateQuery('user:alice', { lastLogin: timeNow() }).toSurQL()
    assertEquals(sql, 'UPDATE user:alice SET lastLogin = time::now()')
  })

  it('mathSum flows through select() projection', () => {
    const sql = select(field('category'), mathSum('price')).fromTable('orders').toSurQL()
    assertEquals(sql, 'SELECT category, math::sum(price) FROM orders')
  })
})

// ---------------------------------------------------------------------------
// Sub-feature #3: extraction aliases
// ---------------------------------------------------------------------------

describe('extractMany / hasResult', () => {
  it('extractMany flattens wrapped envelope', () => {
    assertEquals(extractMany<{ id: string }>([[{ id: '1' }, { id: '2' }]]).length, 2)
  })

  it('extractMany handles bare arrays', () => {
    assertEquals(extractMany<{ id: string }>([{ id: '1' }]).length, 1)
  })

  it('extractMany handles null / undefined', () => {
    assertEquals(extractMany(null).length, 0)
    assertEquals(extractMany(undefined).length, 0)
  })

  it('hasResult returns true when data is present', () => {
    assertEquals(hasResult([[{ id: '1' }]]), true)
  })

  it('hasResult returns false for empty / null', () => {
    assertEquals(hasResult([]), false)
    assertEquals(hasResult(null), false)
    assertEquals(hasResult([[]]), false)
  })
})

describe('extraction end-to-end scalar / one', () => {
  it('extractScalar from GROUP ALL envelope', () => {
    assertEquals(extractScalar<number>([[{ total: 42 }]], 'total'), 42)
  })

  it('extractOne from wrapped envelope', () => {
    assertEquals(extractOne<{ id: string }>([[{ id: 'x' }]])?.id, 'x')
  })
})

// ---------------------------------------------------------------------------
// Sub-feature #4: aggregateRecords (unit-level validation)
// ---------------------------------------------------------------------------

describe('aggregateRecords unit validation', () => {
  const fakeClient = {
    query: (_sql: string) => Promise.resolve([[]]),
  } as unknown as Surreal

  it('rejects empty select', async () => {
    await assertRejects(
      () => aggregateRecords({ table: 't', select: {}, client: fakeClient }),
      Error,
      'select',
    )
  })

  it('rejects combined groupAll + groupBy', async () => {
    await assertRejects(
      () =>
        aggregateRecords({
          table: 't',
          select: { c: count() },
          groupAll: true,
          groupBy: ['x'],
          client: fakeClient,
        }),
      Error,
      'mutually exclusive',
    )
  })

  it('builds SELECT ... GROUP ALL', async () => {
    let captured = ''
    const client = {
      query: (sql: string) => {
        captured = sql
        return Promise.resolve([[{ count: 5 }]])
      },
    } as unknown as Surreal
    await aggregateRecords({
      table: 'memory_entry',
      select: { count: count() },
      groupAll: true,
      client,
    })
    assertEquals(captured, 'SELECT count() AS count FROM memory_entry GROUP ALL')
  })

  it('builds SELECT ... GROUP BY with projected key', async () => {
    let captured = ''
    const client = {
      query: (sql: string) => {
        captured = sql
        return Promise.resolve([[]])
      },
    } as unknown as Surreal
    await aggregateRecords({
      table: 'memory_entry',
      select: { total: mathSum('strength') },
      groupBy: ['network'],
      client,
    })
    assertEquals(
      captured,
      'SELECT network, math::sum(strength) AS total FROM memory_entry GROUP BY network',
    )
  })

  it('honors WHERE / ORDER BY / LIMIT', async () => {
    let captured = ''
    const client = {
      query: (sql: string) => {
        captured = sql
        return Promise.resolve([[]])
      },
    } as unknown as Surreal
    await aggregateRecords({
      table: 'orders',
      select: { n: count() },
      where: 'status = "paid"',
      groupBy: ['region'],
      orderBy: [{ field: 'n', direction: 'DESC' }],
      limit: 10,
      client,
    })
    assertEquals(
      captured,
      'SELECT region, count() AS n FROM orders WHERE status = "paid" GROUP BY region ORDER BY n DESC LIMIT 10',
    )
  })
})

// ---------------------------------------------------------------------------
// updateRecord overload: accept a typeRecord() ref directly
// ---------------------------------------------------------------------------

describe('updateRecord(ref, data) overload', () => {
  it('resolves typeRecord ref into table:id target', async () => {
    let captured = ''
    const client = {
      query: (sql: string) => {
        captured = sql
        return Promise.resolve([[{ id: 'task:abc', status: 'done' }]])
      },
    } as unknown as Surreal
    const ref = typeRecord('task', 'abc')
    await updateRecord(client, ref, { status: 'done' })
    assertEquals(captured, "UPDATE task:abc SET status = 'done'")
  })

  it('preserves the traditional (table, id, data) form', async () => {
    let captured = ''
    const client = {
      query: (sql: string) => {
        captured = sql
        return Promise.resolve([[{ id: 'task:abc', status: 'done' }]])
      },
    } as unknown as Surreal
    await updateRecord(client, 'task', 'abc', { status: 'done' })
    assertEquals(captured, "UPDATE task:abc SET status = 'done'")
  })
})

// ---------------------------------------------------------------------------
// surqlFn still reachable from the public surface
// ---------------------------------------------------------------------------

describe('surqlFn back-compat surface', () => {
  it('surqlFn still renders raw SurrealQL', () => {
    assertEquals(surqlFn('rand::uuid').toSurQL(), 'rand::uuid()')
  })
})
