import type { MetadataRoute } from "next";
import { ROBOTS_DISALLOW, siteUrl } from "@/lib/marketing/site-url";

/** `/robots.txt`: marketing pages are crawlable; the app, auth screens and API are not (QA F-09, SEC-20). */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOW] },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
