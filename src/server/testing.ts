import "server-only";

import { TambikeBackend } from "./backend";

export function createTambikeTestBackend() {
  return TambikeBackend.create();
}
