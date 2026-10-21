export function normalizeWorkspacePaths(value, cwd) {
  if (typeof value === 'string' && value.includes(cwd)) {
    return value.replaceAll(cwd, '{{cwd}}').replace(/\{\{cwd\}\}([\\/])([^\s<>"'`]+)/gu,
      (_match, _separator, path) => `{{cwd}}/${path.replaceAll('\\', '/')}`)
  }
  if (Array.isArray(value)) return value.map(item => normalizeWorkspacePaths(item, cwd))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeWorkspacePaths(item, cwd)]))
  }
  return value
}
