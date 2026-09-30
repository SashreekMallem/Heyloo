import { listBlogPosts } from "@/lib/content/blog";
import { siteUrl } from "@/lib/marketing/site-url";

export async function GET() {
  const base = siteUrl();
  const posts = await listBlogPosts();
  const items = posts
    .map(
      (post) => `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${base}/blog/${post.slug}</link>
      <description>${escapeXml(post.excerpt)}</description>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
    </item>`,
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Heyloo Blog</title>
  <link>${base}/blog</link>
  <description>Heyloo blog</description>
  ${items}
</channel></rss>`;

  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
