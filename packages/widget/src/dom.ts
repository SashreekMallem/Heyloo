/**
 * Minimal DOM helpers — no framework, no dependency (package docstring:
 * "framework-free"). Kept intentionally tiny; every byte here counts
 * against the <25KB gz budget (`scripts/check-size.mjs`).
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  children?: (Node | string)[],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const key in attrs) {
      if (Object.hasOwn(attrs, key)) {
        node.setAttribute(key, attrs[key] as string);
      }
    }
  }
  if (children) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      node.appendChild(
        typeof child === "string" ? document.createTextNode(child) : (child as Node),
      );
    }
  }
  return node;
}
