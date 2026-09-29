import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTierClasses,
  clearHomeClasses,
  HOME_BOOTSTRAP_SCRIPT,
  HOME_CLASSES,
  REDUCED_MOTION_QUERY,
  STAGE_QUERY,
} from "./html-classes";

function mockMedia(matches: Record<string, boolean>) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({ matches: matches[query] ?? false, media: query }) as MediaQueryList,
  );
}

function run(root: HTMLElement, script: string) {
  // The bootstrap is written for `document.documentElement`; point it at `root`.
  new Function("document", "matchMedia", script)({ documentElement: root }, (q: string) =>
    matchMedia(q),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.className = "";
});

describe("tier classes", () => {
  it.each([
    { reduced: false, stage: true, expected: ["fx", "stage"] },
    { reduced: false, stage: false, expected: ["fx", "flow"] },
    { reduced: true, stage: true, expected: ["rm", "stage"] },
    { reduced: true, stage: false, expected: ["rm", "flow"] },
  ])("reduced=$reduced stage=$stage gives $expected", ({ reduced, stage, expected }) => {
    mockMedia({ [REDUCED_MOTION_QUERY]: reduced, [STAGE_QUERY]: stage });
    const root = document.createElement("html");
    applyTierClasses(root);
    expect([...root.classList].sort()).toEqual([...expected].sort());
  });

  it("the inline bootstrap and applyTierClasses agree on every combination", () => {
    for (const reduced of [true, false]) {
      for (const stage of [true, false]) {
        mockMedia({ [REDUCED_MOTION_QUERY]: reduced, [STAGE_QUERY]: stage });
        const viaScript = document.createElement("html");
        const viaFunction = document.createElement("html");
        run(viaScript, HOME_BOOTSTRAP_SCRIPT);
        applyTierClasses(viaFunction);
        expect([...viaScript.classList].sort()).toEqual([...viaFunction.classList].sort());
      }
    }
  });

  it("re-applying after a change flips the classes instead of stacking them", () => {
    const root = document.createElement("html");
    mockMedia({ [REDUCED_MOTION_QUERY]: false, [STAGE_QUERY]: true });
    applyTierClasses(root);
    mockMedia({ [REDUCED_MOTION_QUERY]: true, [STAGE_QUERY]: false });
    applyTierClasses(root);
    expect([...root.classList].sort()).toEqual(["flow", "rm"]);
  });

  it("clearHomeClasses removes every class the page put on <html>, and only those", () => {
    const root = document.createElement("html");
    root.className = `keep-me ${Object.values(HOME_CLASSES).join(" ")}`;
    clearHomeClasses(root);
    expect(root.className).toBe("keep-me");
  });
});
