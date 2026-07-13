import { describe, expect, test } from "vitest";

import {
  closePrismaIntegrationClientPair,
  createPrismaIntegrationClientPair,
} from "../prisma-integration/clients";

const environment = {
  TAMBIKE_RUN_PRISMA_INTEGRATION_TESTS: "1",
  TAMBIKE_TEST_DATABASE_URL:
    "postgresql://integration:secret@127.0.0.1:5432/tambike_test_clients",
};

describe("Prisma integration client helpers", () => {
  test("creates independent clients from the verified disposable URL", () => {
    const receivedUrls: string[] = [];
    const first = { $disconnect: async () => undefined, label: "first" };
    const second = { $disconnect: async () => undefined, label: "second" };

    const clients = createPrismaIntegrationClientPair(environment, (databaseUrl) => {
      receivedUrls.push(databaseUrl);
      return receivedUrls.length === 1 ? first : second;
    });

    expect(clients.primary).toBe(first);
    expect(clients.secondary).toBe(second);
    expect(clients.primary).not.toBe(clients.secondary);
    expect(receivedUrls).toEqual([
      environment.TAMBIKE_TEST_DATABASE_URL,
      environment.TAMBIKE_TEST_DATABASE_URL,
    ]);
  });

  test("closes both clients even when the helper uses a fake test factory", async () => {
    const disconnected: string[] = [];
    const clients = {
      primary: { $disconnect: async () => disconnected.push("primary") },
      secondary: { $disconnect: async () => disconnected.push("secondary") },
    };

    await closePrismaIntegrationClientPair(clients);

    expect(disconnected.sort()).toEqual(["primary", "secondary"]);
  });
});
