/**
 * SurrealDB field types
 */
export enum FieldType {
  STRING = 'string',
  INT = 'int',
  FLOAT = 'float',
  BOOL = 'bool',
  DATETIME = 'datetime',
  DURATION = 'duration',
  DECIMAL = 'decimal',
  NUMBER = 'number',
  OBJECT = 'object',
  ARRAY = 'array',
  RECORD = 'record',
  GEOMETRY = 'geometry',
  ANY = 'any',
}

/**
 * Immutable field definition
 */
export interface FieldDefinition {
  readonly name: string
  readonly type: FieldType
  readonly recordLink?: string
  readonly arrayType?: FieldType
  readonly assertion?: string
  readonly defaultValue?: string
  readonly value?: string
  readonly readonly?: boolean
  readonly flexible?: boolean
  /**
   * Emit the field type wrapped as `option<...>` so a SCHEMAFULL column
   * accepts the absence of a value (NONE). Without it, every record that
   * omits the column is rejected on v3 with a coercion error.
   */
  readonly optional?: boolean
  readonly permissions?: FieldPermissions
}

/**
 * Field-level permissions
 */
export interface FieldPermissions {
  readonly select?: string
  readonly create?: string
  readonly update?: string
  readonly delete?: string
}

function createField(name: string, type: FieldType, options: Partial<FieldDefinition> = {}): FieldDefinition {
  return Object.freeze({ name, type, ...options })
}

/** Generic field */
export function fieldDef(name: string, type: FieldType, options: Partial<FieldDefinition> = {}): FieldDefinition {
  return createField(name, type, options)
}

/** String field */
export function stringField(name: string, options: Partial<FieldDefinition> = {}): FieldDefinition {
  return createField(name, FieldType.STRING, options)
}

/** Integer field */
export function intField(name: string, options: Partial<FieldDefinition> = {}): FieldDefinition {
  return createField(name, FieldType.INT, options)
}

/** Float field */
export function floatField(name: string, options: Partial<FieldDefinition> = {}): FieldDefinition {
  return createField(name, FieldType.FLOAT, options)
}

/** Boolean field */
export function boolField(name: string, options: Partial<FieldDefinition> = {}): FieldDefinition {
  return createField(name, FieldType.BOOL, options)
}

/** Datetime field */
export function datetimeField(name: string, options: Partial<FieldDefinition> = {}): FieldDefinition {
  return createField(name, FieldType.DATETIME, options)
}

/** Duration field */
export function durationField(name: string, options: Partial<FieldDefinition> = {}): FieldDefinition {
  return createField(name, FieldType.DURATION, options)
}

/** Decimal field */
export function decimalField(name: string, options: Partial<FieldDefinition> = {}): FieldDefinition {
  return createField(name, FieldType.DECIMAL, options)
}

/** Number field */
export function numberField(name: string, options: Partial<FieldDefinition> = {}): FieldDefinition {
  return createField(name, FieldType.NUMBER, options)
}

/** Record (foreign key) field */
export function recordField(
  name: string,
  linkedTable: string,
  options: Partial<FieldDefinition> = {},
): FieldDefinition {
  return createField(name, FieldType.RECORD, { ...options, recordLink: linkedTable })
}

/** Array field */
export function arrayField(
  name: string,
  itemType: FieldType = FieldType.ANY,
  options: Partial<FieldDefinition> = {},
): FieldDefinition {
  return createField(name, FieldType.ARRAY, { ...options, arrayType: itemType })
}

/** Object field */
export function objectField(name: string, options: Partial<FieldDefinition> = {}): FieldDefinition {
  return createField(name, FieldType.OBJECT, options)
}

/** Computed / value field */
export function computedField(
  name: string,
  expression: string,
  options: Partial<FieldDefinition> = {},
): FieldDefinition {
  return createField(name, FieldType.ANY, { ...options, value: expression })
}
