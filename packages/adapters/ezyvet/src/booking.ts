/**
 * `pushBooking` for ezyVet — create an appointment tied to a contact
 * (client) record (API_AND_FLOWS.md A.6: "create appointment tied to
 * animal+client records"). Resolves (or creates) the contact by phone
 * first, mirroring the same find-or-create pattern the Square adapter
 * would need for its own Customers API — VERIFY exact `/contact` search
 * query param name and the `/appointment` create body shape
 * (docs/VERIFY.md); the generic `IntegrationAdapter.pushBooking` shape has
 * no dedicated animal/pet field, so pet context rides in `notes`.
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import { z } from "zod";
import type {
  AdapterConnectionCredentials,
  PushBookingParams,
  PushBookingResult,
} from "./adapter-types.js";
import type { EzyVetClient } from "./client.js";

const zContact = z.object({ id: z.union([z.string(), z.number()]) });
const zContactListResponse = z.object({ items: z.array(zContact).optional() });
const zCreateAppointmentResponse = z.object({
  id: z.union([z.string(), z.number()]),
  status: z.union([z.string(), z.number()]).optional(),
});

async function findOrCreateContact(
  client: EzyVetClient,
  accessToken: string,
  params: PushBookingParams,
): Promise<string> {
  const searchQuery = new URLSearchParams({ mobile: params.customerPhoneE164 });
  const searchRaw = await client.request<unknown>(
    "GET",
    `/contact?${searchQuery.toString()}`,
    accessToken,
  );
  const searchParsed = zContactListResponse.safeParse(searchRaw);
  const existing = searchParsed.success ? searchParsed.data.items?.[0] : undefined;
  if (existing) return String(existing.id);

  const [firstName, ...rest] = params.customerName.trim().split(/\s+/);
  const createRaw = await client.request<unknown>("POST", "/contact", accessToken, {
    first_name: firstName || params.customerName,
    last_name: rest.join(" ") || "-",
    mobile: params.customerPhoneE164,
    ...(params.customerEmail ? { email: params.customerEmail } : {}),
  });
  const created = zContact.parse(createRaw);
  return String(created.id);
}

export async function pushEzyVetBooking(
  client: EzyVetClient,
  connection: AdapterConnectionCredentials,
  params: PushBookingParams,
): Promise<PushBookingResult> {
  const accessToken = connection.accessToken;
  if (!accessToken) {
    throw new VoiceProviderError("ezyvet pushBooking requires connection.accessToken", {
      code: "validation",
      provider: "ezyvet",
      retryable: false,
    });
  }

  const contactId = await findOrCreateContact(client, accessToken, params);
  const body = {
    contact_id: contactId,
    physical_resource_id: params.resourceExternalId,
    appointment_type_id: params.serviceExternalId,
    start_time: params.startAt,
    end_time: params.endAt,
    description: params.notes ?? "",
    // ezyVet's own idempotency story is unconfirmed (VERIFY) — the
    // idempotency key rides in description as a defensive marker so a
    // human reviewing a duplicate appointment in the ezyVet UI can spot
    // one, even though it doesn't prevent the write server-side.
    reference: params.idempotencyKey,
  };

  const raw = await client.request<unknown>("POST", "/appointment", accessToken, body);
  const parsed = zCreateAppointmentResponse.parse(raw);
  return { externalId: String(parsed.id), status: "confirmed", deduped: false, raw: parsed };
}
