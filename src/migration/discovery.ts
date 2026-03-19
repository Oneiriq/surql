import type { Migration, MigrationMetadata } from './models.ts'

/**
 * Migration discovery error
 */
export class MigrationDiscoveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationDiscoveryError'
  }
}

/**
 * Migration load error
 */
export class MigrationLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationLoadError'
  }
}

/**
 * Validate a migration filename
 */
export function validateMigrationName(filename: string): boolean {
  return /^\d{14}_[a-z0-9_]+\.(ts|surql)$/.test(filename)
}

/**
 * Extract version from a migration filename
 */
export function getVersionFromFilename(filename: string): string {
  const match = filename.match(/^(\d{14})_/)
  if (!match) throw new MigrationDiscoveryError(`Invalid migration filename: ${filename}`)
  return match[1]
}

/**
 * Extract description from a migration filename
 */
export function getDescriptionFromFilename(filename: string): string {
  const match = filename.match(/^\d{14}_([a-z0-9_]+)\.\w+$/)
  if (!match) throw new MigrationDiscoveryError(`Invalid migration filename: ${filename}`)
  return match[1].replace(/_/g, ' ')
}

/**
 * Discover migration files in a directory
 */
export async function discoverMigrations(directory: string): Promise<MigrationMetadata[]> {
  const metadata: MigrationMetadata[] = []

  try {
    for await (const entry of Deno.readDir(directory)) {
      if (!entry.isFile) continue
      if (!validateMigrationName(entry.name)) continue

      const version = getVersionFromFilename(entry.name)
      const description = getDescriptionFromFilename(entry.name)

      metadata.push({
        version,
        description,
        filename: entry.name,
        filepath: `${directory}/${entry.name}`,
        timestamp: parseInt(version, 10),
      })
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return []
    }
    throw new MigrationDiscoveryError(`Failed to read migration directory: ${e}`)
  }

  return metadata.sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Generate a migration filename from a description
 */
/**
 * Load a migration file and return a Migration object.
 * For .surql files, the content is used as the up() SQL directly.
 * For .ts files, the module is dynamically imported.
 */
export async function loadMigration(filepath: string): Promise<Migration> {
  const filename = filepath.split('/').pop()!
  if (!validateMigrationName(filename)) {
    throw new MigrationLoadError(`Invalid migration filename: ${filename}`)
  }

  const version = getVersionFromFilename(filename)
  const description = getDescriptionFromFilename(filename)

  if (filepath.endsWith('.surql')) {
    const content = await Deno.readTextFile(filepath)
    return {
      version,
      description,
      up: () => Promise.resolve(content),
      down: () => Promise.resolve(`-- Rollback for ${description}`),
    }
  }

  if (filepath.endsWith('.ts')) {
    try {
      const mod = await import(filepath)
      return {
        version,
        description,
        up: mod.up ?? (() => Promise.resolve('')),
        down: mod.down ?? (() => Promise.resolve('')),
      }
    } catch (e) {
      throw new MigrationLoadError(`Failed to load migration ${filepath}: ${e}`)
    }
  }

  throw new MigrationLoadError(`Unsupported migration file type: ${filepath}`)
}

export function generateMigrationFilename(description: string, extension: string = 'surql'): string {
  const now = new Date()
  const timestamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
  const slug = description.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  return `${timestamp}_${slug}.${extension}`
}
