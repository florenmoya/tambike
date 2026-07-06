import "server-only";

import { getTambikeBackend } from "./backend";
import { readSessionToken } from "./session-cookie";

export async function getDemoState() {
  const backend = await getTambikeBackend();
  const token = await readSessionToken();
  return backend.getSnapshot(token ?? undefined);
}
