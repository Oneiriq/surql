import { assert, assertEquals, assertThrows } from '@std/assert'
import { describe, it } from '@std/testing/bdd'
import { FileRef, fileRefToString, isFileRefLike, parseFileRef, toFileRef } from '../types/file.ts'

describe('FileRef', () => {
  it('exposes bucket and key and stringifies to <bucket>:/<key>', () => {
    const f = new FileRef('assets', 'logo.png')
    assertEquals(f.bucket, 'assets')
    assertEquals(f.key, 'logo.png')
    assertEquals(f.toString(), 'assets:/logo.png')
  })

  it('stores the key verbatim (canonical leading slash preserved)', () => {
    const f = new FileRef('assets', '/logo.png')
    // The key is stored exactly as given; SurrealDB's canonical form keeps the
    // leading slash, and toString() still renders a single-slash pointer.
    assertEquals(f.key, '/logo.png')
    assertEquals(f.toString(), 'assets:/logo.png')
  })

  it('toString collapses any leading slashes to a single-slash pointer', () => {
    assertEquals(new FileRef('b', 'k').toString(), 'b:/k')
    assertEquals(new FileRef('b', '/k').toString(), 'b:/k')
    assertEquals(new FileRef('b', '//k').toString(), 'b:/k')
  })

  it('preserves nested key paths', () => {
    assertEquals(new FileRef('assets', 'img/2025/logo.png').toString(), 'assets:/img/2025/logo.png')
    assertEquals(new FileRef('assets', '/img/2025/logo.png').toString(), 'assets:/img/2025/logo.png')
  })

  it('toJSON matches toString', () => {
    assertEquals(new FileRef('b', 'k').toJSON(), 'b:/k')
  })

  it('toObject returns the SQON {bucket,key} form', () => {
    assertEquals(new FileRef('b', 'k').toObject(), { bucket: 'b', key: 'k' })
  })

  it('is frozen', () => {
    assert(Object.isFrozen(new FileRef('b', 'k')))
  })

  it('rejects empty bucket or key', () => {
    assertThrows(() => new FileRef('', 'k'))
    assertThrows(() => new FileRef('b', ''))
  })

  it('equals compares the stored bucket and key fields verbatim', () => {
    const f = new FileRef('b', '/k')
    assert(f.equals(new FileRef('b', '/k')))
    assert(f.equals({ bucket: 'b', key: '/k' }))
    // Stored fields are compared as-is: a differing leading slash is not equal.
    assert(!f.equals({ bucket: 'b', key: 'k' }))
    assert(!f.equals({ bucket: 'b', key: 'other' }))
    assert(!f.equals({ bucket: 'x', key: '/k' }))
    assert(!f.equals('nope'))
  })
})

describe('isFileRefLike', () => {
  it('recognises any {bucket,key} carrier', () => {
    assert(isFileRefLike(new FileRef('b', 'k')))
    assert(isFileRefLike({ bucket: 'b', key: 'k' }))
  })

  it('rejects non-carriers', () => {
    assert(!isFileRefLike(null))
    assert(!isFileRefLike('b:/k'))
    assert(!isFileRefLike({ bucket: 'b' }))
    assert(!isFileRefLike({ bucket: 1, key: 2 }))
  })
})

describe('parseFileRef', () => {
  it('parses the <bucket>:/<key> form, keeping the canonical leading slash', () => {
    const f = parseFileRef('assets:/logo.png')
    assert(f)
    assertEquals(f?.bucket, 'assets')
    assertEquals(f?.key, '/logo.png')
    assertEquals(f?.toString(), 'assets:/logo.png')
  })

  it('parses nested keys with slashes', () => {
    assertEquals(parseFileRef('b:/a/b/c')?.key, '/a/b/c')
  })

  it('returns undefined for non-file strings', () => {
    assertEquals(parseFileRef('not a file'), undefined)
    assertEquals(parseFileRef('table:id'), undefined)
  })
})

describe('toFileRef', () => {
  it('passes through an existing FileRef', () => {
    const f = new FileRef('b', 'k')
    assertEquals(toFileRef(f), f)
  })

  it('coerces a {bucket,key} carrier (e.g. the SDK FileRef shape)', () => {
    const f = toFileRef({ bucket: 'b', key: 'k' })
    assert(f instanceof FileRef)
    assertEquals(f?.toString(), 'b:/k')
  })

  it('coerces a <bucket>:/<key> string', () => {
    assertEquals(toFileRef('b:/k')?.toString(), 'b:/k')
  })

  it('returns undefined for unrelated values', () => {
    assertEquals(toFileRef(42), undefined)
    assertEquals(toFileRef('plain'), undefined)
    assertEquals(toFileRef({ bucket: '', key: 'k' }), undefined)
  })
})

describe('fileRefToString', () => {
  it('renders a file value to its bare form', () => {
    assertEquals(fileRefToString(new FileRef('b', 'k')), 'b:/k')
    assertEquals(fileRefToString({ bucket: 'b', key: 'k' }), 'b:/k')
    assertEquals(fileRefToString('b:/k'), 'b:/k')
  })

  it('falls back to String() for non-file values', () => {
    assertEquals(fileRefToString(42), '42')
  })
})
