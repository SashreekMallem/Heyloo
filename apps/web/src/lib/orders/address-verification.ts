/** DELIVERY-1: why a delivery address is unverified, in the owner's words. */
export function addressVerificationNote(status: string | null | undefined): string | null {
  switch (status) {
    case null:
    case undefined:
    case "in_range":
      return null;
    case "not_found":
      return "Address not verified: it couldn't be found on the map. Confirm it with the customer.";
    case "no_radius_set":
      return "Address found, but no delivery radius is set, so the distance wasn't checked.";
    case "no_business_location":
      return "Address not verified: add your business address in Agent → Business.";
    default:
      return "Address not verified: the address check was unavailable. Confirm it with the customer.";
  }
}
