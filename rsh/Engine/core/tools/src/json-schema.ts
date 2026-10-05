/** Legacy tool-schema exports share the canonical native validation implementation. */
export {
  JsonSchemaError,
  assertObjectJsonSchema,
  assertSupportedJsonSchema,
  isJsonSchemaRecord,
  isPlainJsonArray,
  isPlainJsonRecord,
  validateJsonSchemaValue,
} from '@deepseek-ai/dsh-native-tools/json-schema'
export type {
  JsonSchemaNode,
  JsonSchemaScalar,
  JsonSchemaType,
  ObjectJsonSchema,
} from '@deepseek-ai/dsh-native-tools/json-schema'
