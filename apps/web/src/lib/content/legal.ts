import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

const LEGAL_DIR = path.join(process.cwd(), "content", "legal");

export async function getLegalDoc(slug: "terms" | "privacy" | "dpa") {
  const raw = await readFile(path.join(LEGAL_DIR, `${slug}.mdx`), "utf-8");
  const { data, content } = matter(raw);
  return {
    title: String(data["title"] ?? slug),
    updated: String(data["updated"] ?? ""),
    content,
  };
}
