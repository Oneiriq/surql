import type { EdgeDefinition } from './edge.ts'
import type { TableDefinition } from './table.ts'

/**
 * Generate a Mermaid ER diagram from schema definitions
 */
export function generateMermaid(options: {
  tables?: TableDefinition[]
  edges?: EdgeDefinition[]
  title?: string
}): string {
  const lines: string[] = []
  lines.push('erDiagram')

  for (const table of options.tables ?? []) {
    lines.push(`  ${table.name} {`)
    for (const field of table.fields) {
      const typeStr = field.recordLink ? `record_${field.recordLink}` : field.type
      lines.push(`    ${typeStr} ${field.name}`)
    }
    lines.push('  }')
  }

  for (const edge of options.edges ?? []) {
    if (edge.fromTable && edge.toTable) {
      lines.push(`  ${edge.fromTable} ||--o{ ${edge.toTable} : "${edge.name}"`)
    }
  }

  return lines.join('\n')
}

/**
 * Generate a GraphViz DOT diagram from schema definitions
 */
export function generateGraphViz(options: {
  tables?: TableDefinition[]
  edges?: EdgeDefinition[]
  title?: string
}): string {
  const lines: string[] = []
  const title = options.title ?? 'Schema'

  lines.push(`digraph "${title}" {`)
  lines.push('  rankdir=LR;')
  lines.push('  node [shape=record, style=filled, fillcolor=lightyellow];')
  lines.push('')

  for (const table of options.tables ?? []) {
    const fieldRows = table.fields.map((f) => {
      const typeStr = f.recordLink ? `record<${f.recordLink}>` : f.type
      return `${f.name}: ${typeStr}`
    })
    const label = `{${table.name}|${fieldRows.join('\\l')}\\l}`
    lines.push(`  ${table.name} [label="${label}"];`)
  }

  lines.push('')

  for (const edge of options.edges ?? []) {
    if (edge.fromTable && edge.toTable) {
      lines.push(`  ${edge.fromTable} -> ${edge.toTable} [label="${edge.name}"];`)
    }
  }

  // Record field references
  for (const table of options.tables ?? []) {
    for (const field of table.fields) {
      if (field.recordLink) {
        lines.push(`  ${table.name} -> ${field.recordLink} [label="${field.name}", style=dashed];`)
      }
    }
  }

  lines.push('}')
  return lines.join('\n')
}

/**
 * Generate an ASCII text representation of the schema
 */
export function generateAscii(options: {
  tables?: TableDefinition[]
  edges?: EdgeDefinition[]
}): string {
  const lines: string[] = []

  for (const table of options.tables ?? []) {
    const maxFieldLen = Math.max(...table.fields.map((f) => f.name.length), 4)
    const maxTypeLen = Math.max(...table.fields.map((f) => (f.recordLink ?? f.type).length), 4)
    const width = maxFieldLen + maxTypeLen + 7

    lines.push('+' + '-'.repeat(width) + '+')
    lines.push('| ' + table.name.padEnd(width - 2) + ' |')
    lines.push('+' + '-'.repeat(width) + '+')

    for (const field of table.fields) {
      const typeStr = field.recordLink ? `record<${field.recordLink}>` : field.type
      const line = `| ${field.name.padEnd(maxFieldLen)} | ${typeStr.padEnd(maxTypeLen)} |`
      lines.push(line)
    }

    lines.push('+' + '-'.repeat(width) + '+')
    lines.push('')
  }

  if (options.edges && options.edges.length > 0) {
    lines.push('Edges:')
    for (const edge of options.edges) {
      const from = edge.fromTable ?? '?'
      const to = edge.toTable ?? '?'
      lines.push(`  ${from} --[${edge.name}]--> ${to}`)
    }
  }

  return lines.join('\n')
}
