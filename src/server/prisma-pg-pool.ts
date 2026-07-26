import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

type AttachPool = (pool: Pool) => void;

export function createPrismaPgPool(
  databaseUrl: string,
  attachPool: AttachPool = attachDatabasePool,
) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    min: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    maxLifetimeSeconds: 60,
  });
  attachPool(pool);
  return pool;
}
