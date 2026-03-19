import type { EdgeDefinition } from './edge.ts'
import type { TableDefinition } from './table.ts'

/**
 * Global schema registry for managing table and edge definitions
 */
export class SchemaRegistry {
  private readonly tables: Map<string, TableDefinition> = new Map()
  private readonly edges: Map<string, EdgeDefinition> = new Map()

  registerTable(table: TableDefinition): void {
    this.tables.set(table.name, table)
  }

  registerEdge(edge: EdgeDefinition): void {
    this.edges.set(edge.name, edge)
  }

  getTable(name: string): TableDefinition | undefined {
    return this.tables.get(name)
  }

  getEdge(name: string): EdgeDefinition | undefined {
    return this.edges.get(name)
  }

  listTables(): string[] {
    return [...this.tables.keys()]
  }

  listEdges(): string[] {
    return [...this.edges.keys()]
  }

  getAllTables(): TableDefinition[] {
    return [...this.tables.values()]
  }

  getAllEdges(): EdgeDefinition[] {
    return [...this.edges.values()]
  }

  hasTable(name: string): boolean {
    return this.tables.has(name)
  }

  hasEdge(name: string): boolean {
    return this.edges.has(name)
  }

  clear(): void {
    this.tables.clear()
    this.edges.clear()
  }
}

let _globalRegistry: SchemaRegistry | null = null

/** Get the global schema registry (singleton) */
export function getRegistry(): SchemaRegistry {
  if (!_globalRegistry) {
    _globalRegistry = new SchemaRegistry()
  }
  return _globalRegistry
}

/** Register a table in the global registry */
export function registerTable(table: TableDefinition): void {
  getRegistry().registerTable(table)
}

/** Register an edge in the global registry */
export function registerEdge(edge: EdgeDefinition): void {
  getRegistry().registerEdge(edge)
}

/** Clear the global registry */
export function clearRegistry(): void {
  if (_globalRegistry) _globalRegistry.clear()
}

/** Get all registered table names */
export function getRegisteredTables(): string[] {
  return getRegistry().listTables()
}

/** Get all registered edge names */
export function getRegisteredEdges(): string[] {
  return getRegistry().listEdges()
}
