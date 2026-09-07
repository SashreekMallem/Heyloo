// Pulls @testing-library/jest-dom's Vitest matcher augmentation into the
// tsc -b type-checking program. vitest.setup.ts (which actually installs
// the matchers at test runtime) lives outside `src/`, so tsc's `include`
// never sees it — this file's sole job is making `toBeInTheDocument()` etc.
// type-check in *.test.tsx files without duplicating the import there.
import "@testing-library/jest-dom/vitest";
