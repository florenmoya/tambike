import "server-only";

import { cookies } from "next/headers";

import { BackendError } from "./backend";

export const sessionCookieName = "tambike_session";

export async function readSessionToken() {
  return (await cookies()).get(sessionCookieName)?.value ?? null;
}

export async function readRequiredSessionToken() {
  const token = await readSessionToken();
  if (!token) {
    throw new BackendError("UNAUTHENTICATED");
  }
  return token;
}

export async function setSessionToken(token: string) {
  (await cookies()).set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function clearSessionToken() {
  (await cookies()).delete(sessionCookieName);
}
