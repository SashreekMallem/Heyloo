// See packages/ui/src/vitest-ambient.d.ts for why this file exists: pulls
// jest-dom's Vitest matcher augmentation into tsc -b's program (the actual
// runtime import lives in vitest.setup.ts, outside src/, which tsc's
// `include` never sees).
import "@testing-library/jest-dom/vitest";
