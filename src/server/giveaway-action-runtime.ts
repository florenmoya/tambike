export type GiveawayActionDependencies = {
  readSessionToken(): Promise<string | null>;
};

/**
 * The public action envelope intentionally contains no backend error details.
 * This keeps internal audit facts, claim secrets, and encrypted delivery
 * payload failures from becoming part of the Server Action response surface.
 */
export type GiveawayActionResult<T> =
  | { ok: true; code: "OK"; data: T }
  | { ok: false; code: "UNAUTHENTICATED" | "ERROR" };

export async function executeGiveawayAction<T>(
  dependencies: GiveawayActionDependencies,
  operation: (sessionToken: string) => Promise<T>,
): Promise<GiveawayActionResult<T>> {
  try {
    const sessionToken = await dependencies.readSessionToken();
    if (!sessionToken) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }

    return { ok: true, code: "OK", data: await operation(sessionToken) };
  } catch {
    return { ok: false, code: "ERROR" };
  }
}
