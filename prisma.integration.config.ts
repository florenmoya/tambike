import { defineConfig } from "prisma/config";

import { requirePrismaIntegrationTestDatabaseUrl } from "./tests/prisma-integration/environment";

const testDatabaseUrl = requirePrismaIntegrationTestDatabaseUrl(process.env);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: testDatabaseUrl,
  },
});
