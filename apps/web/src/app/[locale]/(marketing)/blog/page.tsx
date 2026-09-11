import { Container, Section } from "@heyloo/ui";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listBlogPosts } from "@/lib/content/blog";

export const metadata: Metadata = { title: "Blog — Heyloo" };

export default async function BlogIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const posts = await listBlogPosts();

  return (
    <Section spacing="spacious" className="pt-12 md:pt-16">
      <Container size="content">
        <h1 className="font-display text-display font-semibold">Blog</h1>
        <div className="mt-10 divide-y divide-border">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group flex items-start justify-between gap-4 py-6 first:pt-0"
            >
              <div className="space-y-1.5">
                <p className="font-mono text-micro text-muted-foreground">{post.date}</p>
                {/* group-hover:text-accent-text, not text-primary: 18px/semibold
                    falls just short of WCAG's "large text" bold threshold
                    (14pt/18.66px), so the base accent-500's 3.57:1 doesn't
                    clear AA's 4.5:1 for normal text here (DESIGN-4). */}
                <h2 className="text-h4 font-semibold transition-colors group-hover:text-accent-text">
                  {post.title}
                </h2>
                <p className="text-small text-pretty text-muted-foreground">{post.excerpt}</p>
              </div>
              <ArrowRight
                className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden="true"
              />
            </Link>
          ))}
        </div>
      </Container>
    </Section>
  );
}
