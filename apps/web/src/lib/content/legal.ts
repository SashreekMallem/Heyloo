import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

const LEGAL_DIR = path.join(process.cwd(), "content", "legal");

/** The business details every legal doc quotes (company name, address, contacts), kept in
 * one file so they are filled in once: `content/legal/entity.json`. Docs reference them as
 * `{{legal_name}}`, `{{privacy_email}}`, ... */
export type LegalEntity = Record<string, string>;

export async function getLegalEntity(): Promise<LegalEntity> {
  return JSON.parse(await readFile(path.join(LEGAL_DIR, "entity.json"), "utf-8")) as LegalEntity;
}

/** Replaces every `{{key}}` with the entity value; an unknown key throws, so a typo fails the
 * build instead of shipping a raw token. */
export function fillEntity(text: string, entity: LegalEntity): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => {
    const value = entity[key];
    if (value === undefined) throw new Error(`legal docs: unknown placeholder {{${key}}}`);
    return value;
  });
}

export async function getLegalDoc(slug: "terms" | "privacy" | "dpa") {
  const [raw, entity] = await Promise.all([
    readFile(path.join(LEGAL_DIR, `${slug}.mdx`), "utf-8"),
    getLegalEntity(),
  ]);
  const { data, content } = matter(raw);
  return {
    title: String(data["title"] ?? slug),
    updated: String(data["updated"] ?? ""),
    content: fillEntity(content, entity),
  };
}
