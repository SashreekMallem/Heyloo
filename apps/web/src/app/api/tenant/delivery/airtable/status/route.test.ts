import { describe, expect, it, vi } from "vitest";

vi.mock("../session", () => ({
  requireTenantIdFromSession: async () => "tenant-1",
}));

const queriedTables: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerComponentClient: async () => ({
    from: (table: string) => {
      queriedTables.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock of a Supabase query-builder chain.
        then: (resolve: (v: unknown) => void) => {
          if (table === "adapter_connections") {
            resolve({
              data: {
                status: "connected",
                metadata: { base_name: "Bookings Base" },
                last_refreshed_at: "2026-09-01T00:00:00Z",
              },
            });
          } else {
            resolve({
              data: [
                {
                  entity_type: "booking",
                  entity_id: "b1",
                  last_synced_at: "2026-09-01T00:00:00Z",
                  sync_conflict: false,
                },
              ],
            });
          }
        },
        maybeSingle: async () => {
          if (table === "adapter_connections") {
            return {
              data: {
                status: "connected",
                metadata: { base_name: "Bookings Base" },
                last_refreshed_at: "2026-09-01T00:00:00Z",
              },
            };
          }
          return { data: null };
        },
      };
      return builder;
    },
  }),
}));

const { GET } = await import("./route");

describe("GET /api/tenant/delivery/airtable/status", () => {
  it("reads the sync log from adapter_sync_state (filtered provider=airtable), not airtable_sync_state", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sync_log).toHaveLength(1);
    expect(body.sync_log[0].entity_id).toBe("b1");
    expect(queriedTables).toContain("adapter_sync_state");
    expect(queriedTables).not.toContain("airtable_sync_state");
  });
});
