/** Stable model guidance shared by compatibility and Native file-reference providers. */

/** Instructions for interpreting ordinary `@path` text in a user message. */
export const FILE_REFERENCE_PROMPT = 'Tokens prefixed with @ are workspace paths the user explicitly referenced, relative to the workspace root. A trailing slash marks a directory: list it when its contents matter. Anything else is a file: use the read tool when its contents are needed, and do not claim to have inspected it before reading. @"..." quotes a path containing spaces.'
