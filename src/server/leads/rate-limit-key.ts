import { createHmac } from "node:crypto";

const RATE_LIMIT_KEY_DOMAIN = "tambike.lead-rate-limit.v1";

export function deriveLeadRateLimitKey(input: {
  secret: string;
  eventId: string;
  clientAddress: string;
}): string {
  if (input.secret.length < 16) {
    throw new Error("LEAD_RATE_LIMIT_SECRET_INVALID");
  }

  return createHmac("sha256", input.secret)
    .update(`${RATE_LIMIT_KEY_DOMAIN}\0`)
    .update(JSON.stringify([input.eventId, input.clientAddress]))
    .digest("hex");
}
