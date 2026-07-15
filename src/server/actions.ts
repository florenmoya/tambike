"use server";

import type {
  AttendanceType,
  CheckInConfiguration,
  CreateEventInput,
  DemoState,
  ProfileInput,
  ScanMethod,
  ScanPassCode,
  ScanPassResult,
  SelfCheckInActionResult,
  SelfCheckInContextActionResult,
  SelfCheckInCode,
  SignupInput,
} from "@/features/tambike-demo/types";
import { decodeSelfCheckInToken } from "@/features/check-in/qr-token";
import { BackendError, getTambikeBackend } from "./backend";
import { clearSessionToken, readSessionToken, setSessionToken } from "./session-cookie";

async function snapshot(sessionToken?: string): Promise<DemoState> {
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

export async function approvePublishAction(eventId: string) {
  const backend = await getTambikeBackend();
  const token = await readRequiredSessionToken();
  await backend.approvePublish(token, eventId);
  return snapshot();
}

export async function configureCheckInAction(
  eventId: string,
  input: CheckInConfiguration,
) {
  const backend = await getTambikeBackend();
  const token = await readRequiredSessionToken();
  const settings = await backend.configureCheckIn(token, eventId, input);
  return { settings, state: await snapshot(token) };
}

export async function issueSelfCheckInQrAction(eventId: string) {
  const backend = await getTambikeBackend();
  const token = await readRequiredSessionToken();
  return backend.issueSelfCheckInQr(token, eventId);
}

export async function getSelfCheckInContextAction(
  qrToken: string,
): Promise<SelfCheckInContextActionResult> {
  try {
    const token = decodeSelfCheckInToken(qrToken);
    if (!token) {
      throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
    }

    const backend = await getTambikeBackend();
    return { ok: true, context: await backend.getSelfCheckInContext(token) };
  } catch (error) {
    const code = selfCheckInCodeFor(error);
    return {
      ok: false,
      code,
      title: selfCheckInTitleFor(code),
      body: selfCheckInBodyFor(code),
    };
  }
}

export async function selfCheckInAction(qrToken: string): Promise<SelfCheckInActionResult> {
  const backend = await getTambikeBackend();
  const token = decodeSelfCheckInToken(qrToken);

  try {
    if (!token) {
      throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
    }

    const sessionToken = await readRequiredSessionToken();
    const result = await backend.selfCheckIn(sessionToken, token);
    const code: SelfCheckInCode =
      result.status === "confirmed" ? "CHECKED_IN" : "PENDING_CONFIRMATION";
    return {
      ok: true,
      code,
      title: result.status === "confirmed" ? "Checked in" : "Awaiting staff confirmation",
      body:
        result.status === "confirmed"
          ? "Your attendance is confirmed. Perk redemption, if offered, remains a separate staff action."
          : "Your arrival is waiting for staff confirmation. Show this screen so staff can scan your rider pass.",
      status: result.status,
      pass: result.pass,
      state: await snapshot(sessionToken),
    };
  } catch (error) {
    const code = selfCheckInCodeFor(error);
    return {
      ok: false,
      code,
      title: selfCheckInTitleFor(code),
      body: selfCheckInBodyFor(code),
      state: await snapshot(),
    };
  }
}

export async function scanPassAction(
  eventId: string,
  qrToken: string,
  method: ScanMethod,
): Promise<ScanPassResult> {
  const backend = await getTambikeBackend();
  const cleanToken = qrToken.trim();

  try {
    if (!eventId.trim() || !cleanToken) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const sessionToken = await readRequiredSessionToken();
    const pass = await backend.scanPass(sessionToken, eventId, cleanToken, method);

    return {
      ok: true,
      code: "CHECKED_IN",
      outcome: "valid",
      title: "Checked in successfully",
      body: "Tambike Pass matched this event. The rider can enter and claim available check-in perks.",
      pass,
      state: await snapshot(sessionToken),
    };
  } catch (error) {
    const code = scanPassCodeFor(error);
    return {
      ok: false,
      code,
      outcome: scanOutcomeFor(code),
      title: scanTitleFor(code),
      body: scanBodyFor(code),
      state: await snapshot(),
    };
  }
}

async function readRequiredSessionToken() {
  const token = await readSessionToken();
  if (!token) {
    throw new Error("UNAUTHENTICATED");
  }

  return token;
}

function scanPassCodeFor(error: unknown): ScanPassCode {
  if (error instanceof BackendError) {
    return error.code === "CANCELLED_PASS" ||
      error.code === "ALREADY_CHECKED_IN" ||
      error.code === "WRONG_EVENT" ||
      error.code === "NOT_FOUND" ||
      error.code === "UNAUTHENTICATED" ||
      error.code === "FORBIDDEN" ||
      error.code === "INVALID_INPUT"
      ? error.code
      : "ERROR";
  }

  if (error instanceof Error) {
    const message = error.message as ScanPassCode;
    if (
      message === "UNAUTHENTICATED" ||
      message === "FORBIDDEN" ||
      message === "INVALID_INPUT" ||
      message === "NOT_FOUND" ||
      message === "WRONG_EVENT" ||
      message === "ALREADY_CHECKED_IN" ||
      message === "CANCELLED_PASS"
    ) {
      return message;
    }
  }

  return "ERROR";
}

function selfCheckInCodeFor(error: unknown): SelfCheckInCode {
  if (error instanceof BackendError) {
    return (
      error.code === "SELF_CHECK_IN_DISABLED" ||
      error.code === "CHECK_IN_NOT_OPEN" ||
      error.code === "QR_EXPIRED" ||
      error.code === "ALREADY_CHECKED_IN" ||
      error.code === "CANCELLED_PASS" ||
      error.code === "NOT_FOUND" ||
      error.code === "UNAUTHENTICATED" ||
      error.code === "FORBIDDEN"
    )
      ? error.code
      : "ERROR";
  }

  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return "UNAUTHENTICATED";
  }

  return "ERROR";
}

function selfCheckInTitleFor(code: SelfCheckInCode) {
  switch (code) {
    case "SELF_CHECK_IN_DISABLED":
      return "Self check-in is unavailable";
    case "CHECK_IN_NOT_OPEN":
      return "Check-in is not open";
    case "QR_EXPIRED":
      return "This QR is no longer valid";
    case "ALREADY_CHECKED_IN":
      return "Already checked in";
    case "CANCELLED_PASS":
      return "Pass was cancelled";
    case "NOT_FOUND":
      return "No active pass found";
    case "UNAUTHENTICATED":
      return "Log in to check in";
    case "FORBIDDEN":
      return "Rider account required";
    default:
      return "Check-in could not be completed";
  }
}

function selfCheckInBodyFor(code: SelfCheckInCode) {
  switch (code) {
    case "SELF_CHECK_IN_DISABLED":
      return "This event currently requires a staff member to scan rider passes.";
    case "CHECK_IN_NOT_OPEN":
      return "The organizer has not opened rider self check-in. Ask staff for help.";
    case "QR_EXPIRED":
      return "Ask the organizer to show a current QR code, or use the staff scanner.";
    case "ALREADY_CHECKED_IN":
      return "Your attendance has already been recorded for this event.";
    case "CANCELLED_PASS":
      return "Cancelled passes cannot be used for self check-in.";
    case "NOT_FOUND":
      return "Use the event QR for an event where your Tambike Pass is active.";
    case "UNAUTHENTICATED":
      return "Sign in with the rider account that owns the active Tambike Pass, then confirm again.";
    case "FORBIDDEN":
      return "Self check-in is limited to the rider account that owns an active Tambike Pass.";
    default:
      return "Please ask event staff to check you in with the staff scanner.";
  }
}

function scanOutcomeFor(code: ScanPassCode) {
  if (code === "ALREADY_CHECKED_IN") {
    return "already";
  }
  if (code === "WRONG_EVENT") {
    return "wrong-event";
  }
  if (code === "CANCELLED_PASS") {
    return "cancelled";
  }
  return "inactive";
}

function scanTitleFor(code: ScanPassCode) {
  switch (code) {
    case "ALREADY_CHECKED_IN":
      return "Already checked in";
    case "WRONG_EVENT":
      return "Pass belongs to another event";
    case "CANCELLED_PASS":
      return "Pass was cancelled";
    case "NOT_FOUND":
      return "QR pass not found";
    case "UNAUTHENTICATED":
      return "Scanner login expired";
    case "FORBIDDEN":
      return "Scanner access denied";
    case "INVALID_INPUT":
      return "No QR token found";
    default:
      return "Scan failed";
  }
}

function scanBodyFor(code: ScanPassCode) {
  switch (code) {
    case "ALREADY_CHECKED_IN":
      return "Duplicate scans are blocked. Staff should use the original check-in record.";
    case "WRONG_EVENT":
      return "Ask the rider to open the Tambike Pass for this exact event.";
    case "CANCELLED_PASS":
      return "Cancelled passes cannot be checked in or used for perk redemption.";
    case "NOT_FOUND":
      return "This QR token does not match an active Tambike Pass in the system.";
    case "UNAUTHENTICATED":
      return "Log in again with an organizer, venue, or admin account before scanning.";
    case "FORBIDDEN":
      return "Only organizer, venue, and admin accounts can scan passes.";
    case "INVALID_INPUT":
      return "Upload a QR image, start the camera, or paste a pass token.";
    default:
      return "The scanner could not validate this pass. Try again or use manual lookup.";
  }
}
