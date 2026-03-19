import type { EdgeDefinition } from './edge.ts'
import type { TableDefinition } from './table.ts'

/**
 * Schema validation issue
 */
export interface ValidationIssue {
  readonly level: 'error' | 'warning'
  readonly message: string
  readonly table?: string
  readonly field?: string
}

/**
 * Schema validation result
 */
export interface ValidationResult {
  readonly valid: boolean
  readonly issues: readonly ValidationIssue[]
}

/**
 * Validate a set of schema definitions for internal consistency
 */
export function validateSchema(options: {
  tables?: TableDefinition[]
  edges?: EdgeDefinition[]
}): ValidationResult {
  const issues: ValidationIssue[] = []
  const tableNames = new Set((options.tables ?? []).map((t) => t.name))

  // Validate tables
  for (const table of options.tables ?? []) {
    if (!table.name || table.name.trim().length === 0) {
      issues.push({ level: 'error', message: 'Table name is empty', table: table.name })
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(table.name)) {
      issues.push({ level: 'warning', message: `Table name '${table.name}' may not be valid`, table: table.name })
    }

    // Check for duplicate field names
    const fieldNames = new Set<string>()
    for (const field of table.fields) {
      if (fieldNames.has(field.name)) {
        issues.push({
          level: 'error',
          message: `Duplicate field '${field.name}'`,
          table: table.name,
          field: field.name,
        })
      }
      fieldNames.add(field.name)
    }

    // Check record field references
    for (const field of table.fields) {
      if (field.recordLink && !tableNames.has(field.recordLink)) {
        issues.push({
          level: 'warning',
          message: `Field '${field.name}' references unknown table '${field.recordLink}'`,
          table: table.name,
          field: field.name,
        })
      }
    }

    // Check index field references
    for (const idx of table.indexes) {
      for (const idxField of idx.fields) {
        const base = idxField.split('.')[0]
        if (!table.fields.some((f) => f.name === base)) {
          issues.push({
            level: 'warning',
            message: `Index '${idx.name}' references unknown field '${idxField}'`,
            table: table.name,
          })
        }
      }
    }
  }

  // Validate edges
  for (const edge of options.edges ?? []) {
    if (edge.fromTable && !tableNames.has(edge.fromTable)) {
      issues.push({
        level: 'warning',
        message: `Edge '${edge.name}' FROM references unknown table '${edge.fromTable}'`,
      })
    }
    if (edge.toTable && !tableNames.has(edge.toTable)) {
      issues.push({
        level: 'warning',
        message: `Edge '${edge.name}' TO references unknown table '${edge.toTable}'`,
      })
    }
  }

  return Object.freeze({
    valid: issues.filter((i) => i.level === 'error').length === 0,
    issues: Object.freeze([...issues]),
  })
}
