// Plain, Deno-global-free timeout race (no `Deno`/`EdgeRuntime` globals —
// only `setTimeout`/`clearTimeout`, available in both Deno and Node/Vitest).
// Extracted out of `voice-tools/index.ts` (which re-exports it) specifically
// so it is covered by this package's tsconfig.json/Vitest — `index.ts` and
// `_shared/deno/**` are excluded from both (EDGE_AUDIT M2, see
// `docs/BUILD_NOTES.md`'s M2 entry) — see `timeout.test.ts` for the actual
// race/rejection/no-dangling-timer coverage.
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  makeTimeoutError: () => Error = () => new Error("tool_call_timeout"),
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(makeTimeoutError()), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
