import { Container } from "@heyloo/ui/layout/container";
import { Section } from "@heyloo/ui/layout/section";
import { Skeleton } from "@heyloo/ui/primitives/skeleton";

export default function SignupLoading() {
  return (
    <Section spacing="default" className="pb-24">
      <Container size="content" className="mx-auto max-w-md space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </Container>
    </Section>
  );
}
