import "server-only";

import { TambikeBackend, type TambikeTestSeedOptions } from "./backend";

export function createTambikeTestBackend(options?: TambikeTestSeedOptions) {
  return TambikeBackend.create(options);
}
