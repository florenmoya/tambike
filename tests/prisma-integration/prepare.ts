import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
  createPrismaIntegrationChildEnvironment,
  getPrismaIntegrationMigrationArguments,
} from "./environment";

const migrationArguments = getPrismaIntegrationMigrationArguments(process.env);
const childEnvironment = createPrismaIntegrationChildEnvironment(process.env);
const prismaCli = resolve(process.cwd(), "node_modules/prisma/build/index.js");
const result = spawnSync(process.execPath, [prismaCli, ...migrationArguments], {
  cwd: process.cwd(),
  env: childEnvironment,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
