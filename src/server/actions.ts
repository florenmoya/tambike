"use server";

import type {
  AttendanceType,
  CreateEventInput,
  ProfileInput,
  SignupInput,
} from "@/features/tambike-demo/types";
import { getTambikeBackend } from "./backend";
import { clearSessionToken, readSessionToken, setSessionToken } from "./session-cookie";

async function snapshot(sessionToken?: string) {
  const backend = await getTambikeBackend();
  const token = sessionToken ?? (await readSessionToken());
  return backend.getSnapshot(token ?? undefined);
}

export async function loginWithPasswordAction(email: string, password: string) {
  const backend = await getTambikeBackend();
  const result = await backend.loginWithPassword(email, password);
  await setSessionToken(result.sessionToken);
  return snapshot(result.sessionToken);
}

export async function signUpRiderAction(input: SignupInput) {
  const backend = await getTambikeBackend();
  const result = await backend.signUpRider(input);
  await setSessionToken(result.sessionToken);
  return snapshot(result.sessionToken);
}

export async function logoutAction() {
  await clearSessionToken();
  return snapshot();
}

export async function updateProfileAction(input: ProfileInput) {
  const backend = await getTambikeBackend();
  const token = await readRequiredSessionToken();
  await backend.updateProfile(token, input);
  return snapshot();
}

export async function createEventDraftAction(input: CreateEventInput) {
  const backend = await getTambikeBackend();
  const token = await readRequiredSessionToken();
  const event = await backend.createEventDraft(token, input);
  return { state: await snapshot(), event };
}

export async function registerForEventAction(
  eventId: string,
  input: {
    status: "interested" | "going";
    attendanceType: AttendanceType;
    clubName?: string;
  },
) {
  const backend = await getTambikeBackend();
  const token = await readRequiredSessionToken();
  const result = await backend.registerForEvent(token, eventId, input);
  return {
    state: await snapshot(),
    passId: result.pass?.id ?? null,
  };
}

export async function approveVenueWithConditionsAction(eventId: string, conditions: string) {
  const backend = await getTambikeBackend();
  const token = await readRequiredSessionToken();
  await backend.approveVenueWithConditions(token, eventId, conditions);
  return snapshot();
}

export async function approvePublishAction(eventId: string) {
  const backend = await getTambikeBackend();
  const token = await readRequiredSessionToken();
  await backend.approvePublish(token, eventId);
  return snapshot();
}

async function readRequiredSessionToken() {
  const token = await readSessionToken();
  if (!token) {
    throw new Error("UNAUTHENTICATED");
  }

  return token;
}
