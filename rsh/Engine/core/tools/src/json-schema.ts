/** Legacy tool-schema exports share the canonical native validation implementation. */
export {
  JsonSchemaError,
  assertObjectJsonSchema,
  assertSupportedJsonSchema,
  isJsonSchemaRecord,
  isPlainJsonArray,
  isPlainJsonRecord,
  validateJsonSchemaValue,
} from '@redspark/rsh-native-tools/json-schema'
export type {
  JsonSchemaNode,
  JsonSchemaScalar,
  JsonSchemaType,
  ObjectJsonSchema,
} from '@redspark/rsh-native-tools/json-schema'
