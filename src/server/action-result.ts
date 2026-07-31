import type { ActionState } from "@/features/shared/action-state";
import { BackendError } from "@/server/backend";

const defaultMessages: Record<
  "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_INPUT" | "CONFLICT" | "NOT_FOUND",
  string
> = {
  UNAUTHENTICATED: "Log in with an admin account and try again.",
  FORBIDDEN: "Your account cannot perform this action.",
  INVALID_INPUT: "Review the highlighted fields and try again.",
  CONFLICT: "This information changed in another session. Reload and try again.",
  NOT_FOUND: "The requested item is no longer available.",
};

export function actionError(
  error: unknown,
  overrides: Partial<typeof defaultMessages> = {},
): ActionState<never> {
  if (error instanceof BackendError && error.code in defaultMessages) {
    const code = error.code as keyof typeof defaultMessages;
    return {
      status: "error",
      code,
      message: overrides[code] ?? defaultMessages[code],
    };
  }
  throw error;
}
