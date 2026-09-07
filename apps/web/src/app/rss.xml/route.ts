import { listBlogPosts } from "@/lib/content/blog";
import { env } from "@/lib/env";

export async function GET() {
  const posts = await listBlogPosts();
  const items = posts
    .map(
      (post) => `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${env.appBaseUrl}/blog/${post.slug}</link>
      <description>${escapeXml(post.excerpt)}</description>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
    </item>`,
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Heyloo Blog</title>
  <link>${env.appBaseUrl}/blog</link>
  <description>Heyloo blog</description>
  ${items}
</channel></rss>`;

  return new Response(xml, { headers: { "content-type": "application/xml" } });
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
