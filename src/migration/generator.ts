import type { SchemaDiff } from './models.ts'
import { generateMigrationFilename } from './discovery.ts'

/**
 * Migration generation error
 */
export class MigrationGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationGenerationError'
  }
}

/**
 * Generate a migration file from schema diffs
 */
export function generateMigrationFromDiffs(
  diffs: SchemaDiff[],
  description: string,
): { filename: string; upSql: string; downSql: string } {
  if (diffs.length === 0) {
    throw new MigrationGenerationError('No schema differences found')
  }

  const filename = generateMigrationFilename(description)
  const upLines: string[] = ['-- Migration UP']
  const downLines: string[] = ['-- Migration DOWN']

  for (const diff of diffs) {
    upLines.push(diff.sql)
  }

  // Generate reverse operations for DOWN
  for (const diff of [...diffs].reverse()) {
    switch (diff.operation) {
      case 'ADD_TABLE':
        downLines.push(`REMOVE TABLE ${diff.table};`)
        break
      case 'DROP_TABLE':
        downLines.push(`-- Recreate table '${diff.table}' (manual)`)
        break
      case 'ADD_FIELD':
        downLines.push(`REMOVE FIELD ${diff.field} ON TABLE ${diff.table};`)
        break
      case 'DROP_FIELD':
        downLines.push(`-- Recreate field '${diff.field}' on '${diff.table}' (manual)`)
        break
      case 'ADD_INDEX':
        downLines.push(`-- Remove index on '${diff.table}' (manual)`)
        break
      case 'DROP_INDEX':
        downLines.push(`-- Recreate index on '${diff.table}' (manual)`)
        break
      default:
        downLines.push(`-- Reverse: ${diff.details}`)
    }
  }

  return {
    filename,
    upSql: upLines.join('\n'),
    downSql: downLines.join('\n'),
  }
}

/**
 * Generate an initial migration from scratch
 */
export function generateInitialMigration(
  upSql: string,
  description: string = 'initial_schema',
): { filename: string; upSql: string; downSql: string } {
  const filename = generateMigrationFilename(description)
  return {
    filename,
    upSql,
    downSql: '-- DROP all tables (manual)',
  }
}

/**
 * Create a blank migration template
 */
export function createBlankMigration(
  description: string,
): { filename: string; content: string } {
  const filename = generateMigrationFilename(description)
  return {
    filename,
    content: `-- Migration: ${description}\n-- UP\n\n-- DOWN\n`,
  }
}
