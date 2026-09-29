import type { MetadataRoute } from "next";
import { VERTICAL_CONTENT } from "@/content/marketing/verticals";
import { listBlogPosts } from "@/lib/content/blog";
import { siteUrl } from "@/lib/marketing/site-url";

const STATIC_PATHS = [
  "/",
  "/pricing",
  "/demo",
  "/blog",
  "/legal/terms",
  "/legal/privacy",
  "/legal/dpa",
] as const;

/** `/sitemap.xml`: the crawlable marketing pages only (QA F-09, SEC-20). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const posts = await listBlogPosts();
  const verticals = VERTICAL_CONTENT.filter((v) => v.slug !== "generic").map((v) => `/${v.slug}`);
  return [
    ...STATIC_PATHS.map((path) => ({ url: `${base}${path === "/" ? "" : path}` })),
    ...verticals.map((path) => ({ url: `${base}${path}` })),
    ...posts.map((post) => ({
      url: `${base}/blog/${post.slug}`,
      ...(post.date && !Number.isNaN(Date.parse(post.date)) ? { lastModified: post.date } : {}),
    })),
  ];
}
