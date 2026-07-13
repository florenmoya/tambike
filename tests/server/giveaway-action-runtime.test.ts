import { describe, expect, test } from "vitest";

type GiveawayActionDependencies = {
  readSessionToken(): Promise<string | null>;
};

type GiveawayActionResult<T> =
  | { ok: true; code: "OK"; data: T }
  | { ok: false; code: "UNAUTHENTICATED" | "ERROR" };

type ExecuteGiveawayAction = <T>(
  dependencies: GiveawayActionDependencies,
  operation: (sessionToken: string) => Promise<T>,
) => Promise<GiveawayActionResult<T>>;

async function loadGiveawayActionRuntime() {
  // Keep this red-first test compilable until the narrow action runtime is
  // implemented in the next slice. The nonliteral path intentionally avoids
  // turning a missing implementation into a TypeScript resolution error.
  const modulePath = `../../src/server/${"giveaway-action-runtime"}`;
  const runtime = await import(modulePath);
  return runtime as { executeGiveawayAction: ExecuteGiveawayAction };
}

describe("giveaway action runtime", () => {
  test("returns a stable unauthenticated result without data", async () => {
    const { executeGiveawayAction } = await loadGiveawayActionRuntime();
    const dependencies: GiveawayActionDependencies = {
      readSessionToken: async () => null,
    };

    const result = await executeGiveawayAction(dependencies, async () => {
      throw new Error("operation must not run");
    });

    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect("data" in result).toBe(false);
  });

  test("never returns an unexpected error message or claim secret", async () => {
    const { executeGiveawayAction } = await loadGiveawayActionRuntime();
    const dependencies: GiveawayActionDependencies = {
      readSessionToken: async () => "session-token",
    };
    const rawClaimSecret = `tbk_gc1_${"a".repeat(43)}`;

    const result = await executeGiveawayAction(dependencies, async () => {
      throw new Error(`delivery failed for ${rawClaimSecret}`);
    });

    expect(result).toEqual({ ok: false, code: "ERROR" });
    expect(JSON.stringify(result)).not.toContain(rawClaimSecret);
    expect(JSON.stringify(result)).not.toContain("delivery failed");
  });

  test("passes only an authenticated operation result through the narrow envelope", async () => {
    const { executeGiveawayAction } = await loadGiveawayActionRuntime();
    const dependencies: GiveawayActionDependencies = {
      readSessionToken: async () => "session-token",
    };

    const result = await executeGiveawayAction(dependencies, async (sessionToken) => ({
      sessionToken,
      status: "claimable" as const,
    }));

    expect(result).toEqual({
      ok: true,
      code: "OK",
      data: { sessionToken: "session-token", status: "claimable" },
    });
  });
});
