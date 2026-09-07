import type { Metadata } from "next";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getLegalDoc } from "@/lib/content/legal";

export const metadata: Metadata = { title: "Data Processing Addendum — Heyloo" };

export default async function DpaPage() {
  const doc = await getLegalDoc("dpa");
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-semibold">{doc.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated {doc.updated}</p>
      <div className="mt-8 space-y-4 text-sm leading-7">
        <MDXRemote source={doc.content} />
      </div>
    </div>
  );
}
