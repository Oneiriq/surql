#!/usr/bin/env -S deno run -A

import { build, emptyDir } from 'jsr:@deno/dnt@0.42.3'

await emptyDir('./npm')

await build({
  entryPoints: ['./mod.ts'],
  outDir: './npm',
  shims: {
    deno: true,
  },
  package: {
    name: '@oneiriq/surql',
    version: Deno.args[0] || '0.4.0',
    description: 'A modern, type-safe query builder for SurrealDB designed for Deno and Node.js',
    license: 'MIT',
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
  typeCheck: 'both',
  declaration: 'separate',
  scriptModule: 'cjs',
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022'],
  },
})

console.log('\nNPM package built successfully in ./npm directory')
console.log('To publish: cd npm && npm publish\n')
