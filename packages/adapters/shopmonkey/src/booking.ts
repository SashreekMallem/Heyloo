/**
 * `pushBooking` for Shopmonkey — create an appointment/work order tied to
 * a customer (+ vehicle, out of `IntegrationAdapter`'s generic shape —
 * API_AND_FLOWS.md A.6: "create an appointment/work order tied to a
 * customer + vehicle"). Finds or creates the customer by phone first,
 * mirroring the ezyVet adapter's pattern. VERIFY exact `/customer` search
 * query param and `/appointment` create body shape (docs/VERIFY.md).
 */

import { VoiceProviderError } from "@heyloo/canonical-types";
import { z } from "zod";
import type {
  AdapterConnectionCredentials,
  PushBookingParams,
  PushBookingResult,
} from "./adapter-types.js";
import type { ShopmonkeyClient } from "./client.js";

const zCustomer = z.object({ id: z.string() });
const zCustomerListResponse = z.object({ data: z.array(zCustomer).optional() });
const zCreateAppointmentResponse = z.object({ id: z.string(), status: z.string().optional() });

async function findOrCreateCustomer(
  client: ShopmonkeyClient,
  apiKey: string,
  params: PushBookingParams,
): Promise<string> {
  const searchQuery = new URLSearchParams({ phone: params.customerPhoneE164 });
  const searchRaw = await client.request<unknown>(
    "GET",
    `/customer?${searchQuery.toString()}`,
    apiKey,
  );
  const searchParsed = zCustomerListResponse.safeParse(searchRaw);
  const existing = searchParsed.success ? searchParsed.data.data?.[0] : undefined;
  if (existing) return existing.id;

  const createRaw = await client.request<unknown>("POST", "/customer", apiKey, {
    name: params.customerName,
    phone: params.customerPhoneE164,
    ...(params.customerEmail ? { email: params.customerEmail } : {}),
  });
  return zCustomer.parse(createRaw).id;
}

export async function pushShopmonkeyBooking(
  client: ShopmonkeyClient,
  connection: AdapterConnectionCredentials,
  params: PushBookingParams,
): Promise<PushBookingResult> {
  const apiKey = connection.accessToken;
  if (!apiKey) {
    throw new VoiceProviderError(
      "shopmonkey pushBooking requires connection.accessToken (the pasted API key)",
      {
        code: "validation",
        provider: "shopmonkey",
        retryable: false,
      },
    );
  }

  const customerId = await findOrCreateCustomer(client, apiKey, params);
  const body = {
    customerId,
    laborRateId: params.serviceExternalId,
    bayId: params.resourceExternalId,
    startAt: params.startAt,
    endAt: params.endAt,
    notes: params.notes ?? "",
    // Shopmonkey's own idempotency story is unconfirmed (VERIFY) — carried
    // as a defensive reference field, same posture as the ezyVet adapter.
    externalReference: params.idempotencyKey,
  };

  const raw = await client.request<unknown>("POST", "/appointment", apiKey, body);
  const parsed = zCreateAppointmentResponse.parse(raw);
  return { externalId: parsed.id, status: "confirmed", deduped: false, raw: parsed };
}
