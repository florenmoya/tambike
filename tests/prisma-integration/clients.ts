import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import {
  requirePrismaIntegrationTestDatabaseUrl,
  type PrismaIntegrationEnvironment,
} from "./environment";

type DisconnectablePrismaClient = {
  $disconnect: () => Promise<unknown>;
};

export type PrismaIntegrationClientPair<TClient extends DisconnectablePrismaClient> = {
  primary: TClient;
  secondary: TClient;
};

/**
 * Builds two independently configured clients for a concurrency test. The
 * clients do not issue a query until the calling integration test does so.
 */
export function createPrismaIntegrationClientPair<TClient extends DisconnectablePrismaClient>(
  environment: PrismaIntegrationEnvironment,
  createClient: (databaseUrl: string) => TClient,
): PrismaIntegrationClientPair<TClient> {
  const databaseUrl = requirePrismaIntegrationTestDatabaseUrl(environment);
  return {
    primary: createClient(databaseUrl),
    secondary: createClient(databaseUrl),
  };
}

function createPrismaIntegrationClient(databaseUrl: string) {
  return new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
}

export function createPrismaIntegrationClients(
  environment: PrismaIntegrationEnvironment = process.env,
) {
  return createPrismaIntegrationClientPair(environment, createPrismaIntegrationClient);
}

export async function closePrismaIntegrationClientPair<TClient extends DisconnectablePrismaClient>(
  clients: PrismaIntegrationClientPair<TClient>,
) {
  await Promise.all([clients.primary.$disconnect(), clients.secondary.$disconnect()]);
}
