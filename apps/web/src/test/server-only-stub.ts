// Test-environment stand-in for the `server-only` package (aliased in
// vitest.config.ts). The real package's default export condition throws
// ("This module cannot be imported from a Client Component module") because
// it assumes a bundler that sets the `react-server` export condition;
// vitest's jsdom environment doesn't, so every `import "server-only"` in a
// unit-tested module would otherwise throw on import. A no-op here is safe:
// this repo's tests only unit-test individual server-side modules (Route
// Handlers, auth guards) directly, never through a Client Component import
// path, so the real guarantee `server-only` provides has nothing to catch.
export {};
