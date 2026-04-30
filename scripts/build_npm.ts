#!/usr/bin/env -S deno run -A

import { build, emptyDir } from 'jsr:@deno/dnt@0.42.3'

const denoJson = JSON.parse(await Deno.readTextFile('./deno.json'))
const version: string = Deno.args[0] || denoJson.version || '0.0.0'

await emptyDir('./npm')

await build({
  entryPoints: ['./mod.ts'],
  outDir: './npm',
  shims: {
    deno: true,
  },
  package: {
    name: '@oneiriq/surql',
    version,
    description: 'A modern, type-safe query builder for SurrealDB designed for Deno and Node.js',
    license: 'Apache-2.0',
    author: {
      name: 'oneiriq',
    },
    publishConfig: {
      access: 'public',
    },
    repository: {
      type: 'git',
      url: 'git+https://github.com/oneiriq/surql.git',
    },
    bugs: {
      url: 'https://github.com/oneiriq/surql/issues',
    },
    homepage: 'https://github.com/oneiriq/surql#readme',
    keywords: [
      'surrealdb',
      'query-builder',
      'database',
      'typescript',
      'deno',
      'nodejs',
      'type-safe',
      'fluent-api',
      'orm',
    ],
    engines: {
      node: '>=18.0.0',
    },
    dependencies: {
      'surrealdb': '^2.0.0',
      'zod': '^4.0.0',
    },
  },
  postBuild() {
    Deno.copyFileSync('LICENSE', 'npm/LICENSE')
    Deno.copyFileSync('README.md', 'npm/README.md')
    Deno.copyFileSync('CHANGELOG.md', 'npm/CHANGELOG.md')
  },
  importMap: './deno.json',
  test: false,
  // typeCheck: 'both' fails because @deno/shim-deno doesn't expose
  // newer Deno APIs we use legitimately on the Deno side
  // (Deno.Command + Deno.CommandOutput in src/migration/hooks.ts).
  // The Deno-side type check already runs in `deno check mod.ts`
  // (test.yml + check.yml), so re-checking the dnt-transformed npm
  // output is redundant.
  typeCheck: false,
  declaration: 'separate',
  scriptModule: 'cjs',
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022'],
  },
})

console.log('\nNPM package built successfully in ./npm directory')
console.log('To publish: cd npm && npm publish\n')
