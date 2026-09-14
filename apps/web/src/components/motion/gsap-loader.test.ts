import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetGsapLoaderForTests, loadGsap } from "./gsap-loader";

const registerPlugin = vi.fn();
vi.mock("gsap", () => ({ gsap: { registerPlugin } }));
vi.mock("gsap/ScrollTrigger", () => ({ default: { name: "ScrollTrigger" } }));

afterEach(() => {
  vi.clearAllMocks();
  __resetGsapLoaderForTests();
});

describe("loadGsap", () => {
  it("registers the ScrollTrigger plugin exactly once", async () => {
    await loadGsap();
    await loadGsap();
    expect(registerPlugin).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight/resolved module across every caller (no duplicate dynamic imports)", async () => {
    const [first, second] = await Promise.all([loadGsap(), loadGsap()]);
    expect(first.gsap).toBe(second.gsap);
    expect(first.ScrollTrigger).toBe(second.ScrollTrigger);
  });
});
