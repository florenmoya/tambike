export type ActionCode =
  | "SUCCESS"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "NOT_FOUND";

export type ActionState<T = undefined> =
  | { status: "idle"; message: "" }
  | { status: "success"; code: "SUCCESS"; message: string; data: T }
  | {
      status: "error";
      code: Exclude<ActionCode, "SUCCESS">;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };
