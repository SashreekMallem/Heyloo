import { createRetellNativeProvider } from "./retell-native.ts";
import { createTwilioProvider, type TwilioNumberDeps } from "./twilio.ts";
import { type NumberRecord, type PhoneNumberProvider, resolveNumberProviderId } from "./types.ts";

export type PhoneNumberRegistryDeps = TwilioNumberDeps;

export interface PhoneNumberRegistry {
  /** The adapter for this number's provider, decided from the canonical row. */
  forNumber(number: Pick<NumberRecord, "twilioSid">): PhoneNumberProvider;
}

export function createPhoneNumberRegistry(deps: PhoneNumberRegistryDeps): PhoneNumberRegistry {
  const retellNative = createRetellNativeProvider(deps);
  const twilio = createTwilioProvider(deps);
  return {
    forNumber(number) {
      return resolveNumberProviderId(number) === "twilio" ? twilio : retellNative;
    },
  };
}
