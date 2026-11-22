// Config helpers.
//
// DSH turns `.volatile()` Config fields into refs with `.get()`. The same code
// also runs in unit tests with plain objects, so every read goes through `cv`.

export function cv(value, fallback) {
  const current = value && typeof value === 'object' && typeof value.get === 'function'
    ? value.get()
    : value
  return current === undefined ? fallback : current
}

export function configKey(config) {
  return [
    cv(config.runtime, 'external'),
    cv(config.endpoint, ''),
    cv(config.uiUrl, ''),
    cv(config.artexDir, ''),
    cv(config.composeFile, ''),
    cv(config.projectName, ''),
    cv(config.binaryPath, ''),
  ].join('\u0000')
}
