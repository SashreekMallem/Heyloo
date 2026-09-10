"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  DataState,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@heyloo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { TeamListResponse } from "@/app/api/tenant/team/route";
import { useCurrentTenantId } from "@/lib/tenant/tenant-context";

/**
 * Team management (docs/audit/FIX_REQUESTS.md — "team-invite UI/backend
 * needed for a real 'Invite your team' setup-progress action"). Invite
 * requires an owner session (the backend re-checks this independently —
 * this page's own gating is a UX nicety, not the security boundary).
 */
export default function TeamPage() {
  const tenantId = useCurrentTenantId();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);

  const query = useQuery({
    queryKey: ["tenant", tenantId, "team"],
    queryFn: async (): Promise<TeamListResponse> => {
      const res = await fetch("/api/tenant/team");
      if (!res.ok) throw new Error("failed to load team");
      return (await res.json()) as TeamListResponse;
    },
    enabled: !!tenantId,
  });

  async function sendInvite() {
    if (!email.trim()) return;
    setInviting(true);
    try {
      const res = await fetch("/api/tenant/team/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        invited?: boolean;
        reason?: string;
        error?: string;
      };
      if (!res.ok) {
        toast.error(
          body.error === "not_tenant_owner"
            ? "Only the account owner can invite teammates."
            : "Couldn't send the invite — please try again.",
        );
        return;
      }
      if (body.invited === false && body.reason === "already_a_member") {
        toast.info("That person is already on your team.");
      } else {
        toast.success(`Invite sent to ${email.trim()}`);
      }
      setEmail("");
      void queryClient.invalidateQueries({ queryKey: ["tenant", tenantId, "team"] });
    } catch {
      toast.error("Couldn't send the invite — please try again.");
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Team" description="Give teammates their own dashboard sign-in." />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm text-muted-foreground">
            Give a teammate their own dashboard sign-in. They&apos;ll get an email invite to set a
            password.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "admin" | "member")}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void sendInvite()} disabled={inviting || !email.trim()}>
              {inviting ? "Sending…" : "Send invite"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <DataState
            query={query}
            empty={{
              title: "No teammates yet",
              description: "Invite one above to give them their own dashboard sign-in.",
              // Never trust the response shape blindly — a non-matching payload
              // (error fallback, stale cache, etc.) must read as empty, not crash.
              isEmpty: (data) => !Array.isArray(data.members) || data.members.length === 0,
            }}
            render={(data) => (
              <ul className="divide-y divide-border">
                {data.members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">{m.email ?? m.invited_email ?? "—"}</p>
                      {!m.accepted && (
                        <p className="text-xs text-muted-foreground">Invited — not yet accepted</p>
                      )}
                    </div>
                    <Badge variant={m.role === "owner" ? "default" : "outline"}>{m.role}</Badge>
                  </li>
                ))}
              </ul>
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}
