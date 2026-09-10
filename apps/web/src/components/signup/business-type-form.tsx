"use client";

import {
  type SignupBusinessType,
  signupBusinessTypeSchema,
  type Vertical,
} from "@heyloo/canonical-types";
import {
  Button,
  cn,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  VerticalIcon,
  WizardStepper,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { VERTICAL_CONTENT } from "@/content/marketing/verticals";
import { useRouter } from "@/i18n/navigation";
import { SIGNUP_STEPS } from "@/lib/marketing/signup-steps";

export function BusinessTypeForm({
  initialVertical,
  demoId,
}: {
  initialVertical?: Vertical;
  demoId?: string;
}) {
  const router = useRouter();
  const form = useForm<SignupBusinessType>({
    resolver: zodResolver(signupBusinessTypeSchema),
    defaultValues: { business_type: initialVertical ?? "generic", business_name: "" },
  });

  async function onSubmit(values: SignupBusinessType) {
    const res = await fetch("/api/signup/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...values, demo_id: demoId }),
    });
    if (res.ok) router.push("/signup/plan");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-1.5 text-center">
        <h1 className="font-display text-h2 font-semibold">
          Let&apos;s set up your AI receptionist
        </h1>
        <p className="text-small text-muted-foreground">
          Six quick steps — most take under a minute.
        </p>
      </div>
      <WizardStepper steps={SIGNUP_STEPS} current={0} completed={[]} />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="business_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>What kind of business do you run?</FormLabel>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {VERTICAL_CONTENT.map((v) => (
                    <button
                      key={v.vertical}
                      type="button"
                      onClick={() => field.onChange(v.vertical)}
                      className={cn(
                        "flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border p-4 text-center text-small transition-colors duration-(--duration-fast) ease-(--ease-out)",
                        field.value === v.vertical
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:border-primary/40 hover:bg-secondary",
                      )}
                    >
                      <VerticalIcon
                        vertical={v.vertical}
                        className={cn(
                          "size-5",
                          field.value === v.vertical ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      {v.slug === "generic" ? "Something else" : v.displayName}
                    </button>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="business_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Business name</FormLabel>
                <FormControl>
                  <Input placeholder="Sunrise Group" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" className="w-full">
            Continue
          </Button>
        </form>
      </Form>
    </div>
  );
}
