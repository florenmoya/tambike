import { defineConfig } from "prisma/config";
import { loadEnvConfig } from "@next/env";
import { getMigrationDatabaseUrl, getShadowDatabaseUrl } from "./src/server/database-url";

loadEnvConfig(process.cwd());

const migrationDatabaseUrl = getMigrationDatabaseUrl();
const shadowDatabaseUrl = getShadowDatabaseUrl();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  ...(migrationDatabaseUrl
    ? {
        datasource: {
          url: migrationDatabaseUrl,
          ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
        },
      }
    : {}),
});
