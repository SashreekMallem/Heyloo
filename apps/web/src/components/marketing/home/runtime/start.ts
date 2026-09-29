import { HOME_CLASSES } from "./html-classes";
import { type HomePageHandle, runHomePage } from "./page-runtime";

/**
 * The lazy entry of the motion runtime (its own chunk). Loads the motion
 * libraries (gsap with ScrollTrigger and SplitText, Lenis) only when motion is
 * allowed; reduced motion needs none of them. The 3D scene is a further chunk
 * that `runHomePage` pulls in by itself.
 *
 * Static imports of gsap and lenis are forbidden everywhere else (see
 * `home-motion-imports.test.ts`): they must stay behind this dynamic import so
 * they never land in a route's initial JS.
 */
export async function startHomeRuntime(): Promise<HomePageHandle> {
  const reduced = document.documentElement.classList.contains(HOME_CLASSES.rm);
  if (reduced) return runHomePage(null);

  const [gsapModule, scrollTriggerModule, splitTextModule, lenisModule] = await Promise.all([
    import("gsap"),
    import("gsap/ScrollTrigger"),
    import("gsap/SplitText"),
    import("lenis"),
  ]);
  return runHomePage({
    gsap: gsapModule.gsap,
    ScrollTrigger: scrollTriggerModule.default,
    SplitText: splitTextModule.SplitText,
    Lenis: lenisModule.default,
  });
}
