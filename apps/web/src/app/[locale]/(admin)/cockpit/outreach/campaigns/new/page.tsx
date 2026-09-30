"use client";

import { type OutreachCampaign, outreachCampaignSchema, VERTICALS } from "@heyloo/canonical-types";
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@heyloo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { describeCampaignCreateFailure } from "./create-campaign";

export default function NewCampaignPage() {
  const router = useRouter();
  const form = useForm<OutreachCampaign>({
    resolver: zodResolver(outreachCampaignSchema),
    defaultValues: {
      name: "",
      vertical: "generic",
      sending_domain: "",
      daily_send_cap: 100,
      template_id: "",
      respect_suppression: true,
    },
  });

  async function onSubmit(values: OutreachCampaign) {
    const res = await fetch("/api/admin/admin-outreach/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    if (res.ok) {
      toast.success("Campaign created");
      router.push("/cockpit/outreach/campaigns");
      return;
    }
    const body: unknown = await res.json().catch(() => null);
    const failure = describeCampaignCreateFailure(res.status, body);
    for (const { field, message } of failure.fieldErrors) form.setError(field, { message });
    toast.error(failure.message);
  }

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader title="New campaign" />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vertical"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vertical</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {VERTICALS.map((v) => (
                      <SelectItem key={v} value={v} className="capitalize">
                        {v.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="sending_domain"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Sending domain</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="mail.example.com" autoComplete="off" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="daily_send_cap"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Daily send cap</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    max={2000}
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="template_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Template ID (optional)</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ""}
                    placeholder="A template UUID, or leave blank"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex items-center gap-2">
            <Checkbox
              id="respect-suppression-list"
              checked
              disabled
              aria-label="Respect suppression list (always on)"
            />
            <Label htmlFor="respect-suppression-list" className="font-normal">
              Respect suppression list (always on)
            </Label>
          </div>
          <Button type="submit">Create campaign</Button>
        </form>
      </Form>
    </div>
  );
}
