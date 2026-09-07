import type { Metadata } from "next";
import { DemoFlow } from "@/components/demo/demo-flow";

export const metadata: Metadata = {
  title: "Try a live demo — Heyloo",
  description: "Build a personalized AI receptionist demo from your own website in under a minute.",
};

/** `/demo` (FRONTEND_SPEC.md §3.4) — the most interactive marketing surface, hosted as a client `<DemoFlow>` state machine in one route. */
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ vertical?: string }>;
}) {
  const { vertical } = await searchParams;
  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="mb-10 text-center text-3xl font-semibold tracking-tight">
        Hear your AI receptionist in under a minute
      </h1>
      <DemoFlow initialVertical={vertical} />
    </div>
  );
}
