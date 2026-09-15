import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { MDXRemote } from "next-mdx-remote/rsc";
import { Link } from "@/i18n/navigation";
import { getBlogPost, listBlogPosts } from "@/lib/content/blog";

export async function generateStaticParams() {
  const posts = await listBlogPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) return {};
  return { title: `${post.title} — Heyloo blog`, description: post.excerpt };
}

const PROSE_CLASSES =
  "space-y-4 text-body leading-7 text-foreground [&_a]:text-accent-text [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-small [&_h2]:pt-4 [&_h2]:font-display [&_h2]:text-h3 [&_h2]:font-semibold [&_h3]:pt-2 [&_h3]:text-h4 [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ul]:list-disc [&_ul]:space-y-1.5";

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const post = await getBlogPost(slug);
  if (!post) notFound();

  return (
    <Section spacing="spacious" className="pt-12 md:pt-16">
      <Container size="content">
        <article>
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-small font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to blog
          </Link>
          <p className="mt-4 font-mono text-micro text-muted-foreground">{post.date}</p>
          <h1 className="mt-1 font-display text-display font-semibold text-balance">
            {post.title}
          </h1>
          <div className={`mt-8 ${PROSE_CLASSES}`}>
            <MDXRemote source={post.content} />
          </div>
        </article>
      </Container>
    </Section>
  );
}
