import { assertEquals, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { GraphQuery, GraphQueryError } from '../query/graphQuery.ts'

describe('GraphQuery', () => {
  describe('toSurql', () => {
    it('emits basic outgoing traversal', () => {
      const { sql, vars } = new GraphQuery('user:alice').out('follows').toSurql()
      assertEquals(sql, 'SELECT * FROM user:alice->follows')
      assertEquals(vars, {})
    })

    it('emits incoming edge', () => {
      const { sql } = new GraphQuery('user:alice').in_('follows').toSurql()
      assertEquals(sql, 'SELECT * FROM user:alice<-follows')
    })

    it('emits bidirectional edge', () => {
      const { sql } = new GraphQuery('user:alice').both('knows').toSurql()
      assertEquals(sql, 'SELECT * FROM user:alice<->knows')
    })

    it('chains multiple hops in order', () => {
      const { sql } = new GraphQuery('user:alice')
        .out('follows')
        .out('follows')
        .toSurql()
      assertEquals(sql, 'SELECT * FROM user:alice->follows->follows')
    })

    it('expands depth into repeated v3-valid edge steps', () => {
      const { sql } = new GraphQuery('user:alice').out('follows', 2).toSurql()
      // Two hops => two `->follows->?` steps
      assertEquals(sql, 'SELECT * FROM user:alice->follows->?->follows->?')
    })

    it('expands incoming depth likewise', () => {
      const { sql } = new GraphQuery('user:alice').in_('follows', 3).toSurql()
      assertEquals(sql, 'SELECT * FROM user:alice<-follows<-?<-follows<-?<-follows<-?')
    })

    it('targets a specific table', () => {
      const { sql } = new GraphQuery('user:alice').out('likes').to('post').toSurql()
      assertEquals(sql, 'SELECT * FROM user:alice->likes->post')
    })

    it('ANDs multiple where conditions', () => {
      const { sql } = new GraphQuery('user:alice')
        .out('follows')
        .where('age > 18')
        .where('id != user:alice')
        .toSurql()
      assertEquals(
        sql,
        'SELECT * FROM user:alice->follows WHERE (age > 18) AND (id != user:alice)',
      )
    })

    it('selects specified fields', () => {
      const { sql } = new GraphQuery('user:alice').out('follows').select('id', 'name').toSurql()
      assertEquals(sql, 'SELECT id, name FROM user:alice->follows')
    })

    it('renders limit', () => {
      const { sql } = new GraphQuery('user:alice').out('follows').limit(50).toSurql()
      assertEquals(sql, 'SELECT * FROM user:alice->follows LIMIT 50')
    })

    it('renders fetch refs', () => {
      const { sql } = new GraphQuery('user:alice').out('follows').fetch('author', 'tags').toSurql()
      assertEquals(sql, 'SELECT * FROM user:alice->follows FETCH author, tags')
    })

    it('renders all clauses together in canonical order', () => {
      const { sql } = new GraphQuery('user:alice')
        .out('likes')
        .to('post')
        .where('published = true')
        .select('id', 'title')
        .fetch('author')
        .limit(10)
        .toSurql()
      assertEquals(
        sql,
        'SELECT id, title FROM user:alice->likes->post WHERE (published = true) FETCH author LIMIT 10',
      )
    })
  })

  describe('validation', () => {
    it('throws when no traversal step is configured', () => {
      assertThrows(
        () => new GraphQuery('user:alice').toSurql(),
        GraphQueryError,
        'at least one traversal step',
      )
    })

    it('throws when start is empty', () => {
      assertThrows(() => new GraphQuery(''), GraphQueryError)
    })

    it('throws on negative limit', () => {
      assertThrows(() => new GraphQuery('user:alice').out('follows').limit(-1), GraphQueryError)
    })

    it('throws on zero depth', () => {
      assertThrows(() => new GraphQuery('user:alice').out('follows', 0), GraphQueryError)
    })

    it('throws on non-integer depth', () => {
      assertThrows(() => new GraphQuery('user:alice').out('follows', 1.5), GraphQueryError)
    })
  })
})
