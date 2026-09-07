import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

const BLOG_DIR = path.join(process.cwd(), "content", "blog");

export interface BlogPostMeta {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
}

export interface BlogPost extends BlogPostMeta {
  content: string;
}

/** In-repo MDX (FRONTEND_SPEC.md §3.5) — RSC reads frontmatter for the index, full content for `[slug]`. */
export async function listBlogPosts(): Promise<BlogPostMeta[]> {
  const files = await readdir(BLOG_DIR);
  const posts = await Promise.all(
    files
      .filter((file) => file.endsWith(".mdx"))
      .map(async (file) => {
        const raw = await readFile(path.join(BLOG_DIR, file), "utf-8");
        const { data } = matter(raw);
        return {
          slug: file.replace(/\.mdx$/, ""),
          title: String(data["title"] ?? file),
          excerpt: String(data["excerpt"] ?? ""),
          date: String(data["date"] ?? ""),
        };
      }),
  );
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getBlogPost(slug: string): Promise<BlogPost | null> {
  try {
    const raw = await readFile(path.join(BLOG_DIR, `${slug}.mdx`), "utf-8");
    const { data, content } = matter(raw);
    return {
      slug,
      title: String(data["title"] ?? slug),
      excerpt: String(data["excerpt"] ?? ""),
      date: String(data["date"] ?? ""),
      content,
    };
  } catch {
    return null;
  }
}
