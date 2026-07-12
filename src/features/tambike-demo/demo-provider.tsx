"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  approvePublishAction,
  approveVenueWithConditionsAction,
  configureCheckInAction,
  createEventDraftAction,
  issueSelfCheckInQrAction,
  loginWithPasswordAction,
  logoutAction,
  registerForEventAction,
  scanPassAction,
  signUpRiderAction,
  updateProfileAction,
} from "@/server/actions";
import type {
  AttendanceType,
  CheckInConfiguration,
  CreateEventInput,
  DemoState,
  Event,
  EventCheckInSettings,
  Pass,
  ProfileInput,
  Role,
  ScanMethod,
  ScanPassResult,
  ScannerOutcome,
  SelfCheckInQr,
  SignupInput,
  UserProfile,
} from "./types";

interface DemoContextValue {
  role: Role;
  users: UserProfile[];
  currentUser: UserProfile | null;
  authNotice: string;
  setAuthNotice: (notice: string) => void;
  loginWithPassword: (email: string, password: string) => Promise<UserProfile | null>;
  signUpRider: (input: SignupInput) => Promise<UserProfile>;
  logout: () => Promise<void>;
  updateProfile: (input: ProfileInput) => Promise<void>;
  requireLogin: (notice: string) => boolean;
  events: Event[];
  passes: Pass[];
  checkInSettings: EventCheckInSettings[];
  applyServerState: (state: DemoState) => void;
  createEventDraft: (input: CreateEventInput) => Promise<Event | null>;
  attendanceType: AttendanceType;
  passCreated: boolean;
  registerForEvent: (
    eventId: string,
    attendanceType: AttendanceType,
    status?: "interested" | "going",
  ) => Promise<string | null>;
  scannerOutcome: ScannerOutcome;
  setScannerOutcome: (outcome: ScannerOutcome) => void;
  scanPass: (eventId: string, qrToken: string, method: ScanMethod) => Promise<ScanPassResult>;
  configureCheckIn: (
    eventId: string,
    input: CheckInConfiguration,
  ) => Promise<EventCheckInSettings>;
  issueSelfCheckInQr: (eventId: string) => Promise<SelfCheckInQr>;
  checkedInCount: number;
  venueConditions: string;
  setVenueConditions: (conditions: string) => void;
  venueDecision: "pending" | "approved_with_conditions";
  approveVenueWithConditions: () => Promise<void>;
  adminDecision: "pending" | "published";
  approvePublish: (eventId: string) => Promise<void>;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState: DemoState;
}) {
  const [users, setUsers] = useState<UserProfile[]>(initialState.users);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(initialState.currentUser);
  const [authNotice, setAuthNotice] = useState("");
  const [events, setEvents] = useState<Event[]>(initialState.events);
  const [passes, setPasses] = useState<Pass[]>(initialState.passes);
  const [checkInSettings, setCheckInSettings] = useState<EventCheckInSettings[]>(
    initialState.checkInSettings ?? [],
  );
  const [attendanceType, setAttendanceType] = useState<AttendanceType>("direct");
  const [passCreated, setPassCreated] = useState(initialState.passCreated);
  const [scannerOutcome, setScannerOutcomeState] = useState<ScannerOutcome>("idle");
  const [venueConditions, setVenueConditions] = useState(
    "Max 120 riders. Parking marshals required. Quiet exit after 10 PM.",
  );
  const [venueDecision, setVenueDecision] = useState<"pending" | "approved_with_conditions">(
    "pending",
  );
  const [adminDecision, setAdminDecision] = useState<"pending" | "published">("pending");

  const role: Role = currentUser?.role ?? "guest";

  const applyState = useCallback((nextState: DemoState) => {
    setUsers(nextState.users);
    setCurrentUser(nextState.currentUser);
    setEvents(nextState.events);
    setPasses(nextState.passes);
    setCheckInSettings(nextState.checkInSettings ?? []);
    setPassCreated(nextState.passCreated);
  }, []);

  const checkedInCount = useMemo(
    () => events.reduce((total, event) => total + (event.confirmedCheckIns ?? 0), 0),
    [events],
  );

  const loginWithPassword = useCallback(
    async (email: string, password: string) => {
      const nextState = await loginWithPasswordAction(email, password);
      applyState(nextState);
      setAuthNotice("");
      return nextState.currentUser;
    },
    [applyState],
  );

  const signUpRider = useCallback(
    async (input: SignupInput) => {
      const nextState = await signUpRiderAction(input);
      applyState(nextState);
      setAuthNotice("");
      if (!nextState.currentUser) {
        throw new Error("SIGNUP_FAILED");
      }
      return nextState.currentUser;
    },
    [applyState],
  );

  const logout = useCallback(async () => {
    const nextState = await logoutAction();
    applyState(nextState);
    setAuthNotice("");
  }, [applyState]);

  const updateProfile = useCallback(
    async (input: ProfileInput) => {
      const nextState = await updateProfileAction(input);
      applyState(nextState);
    },
    [applyState],
  );

  const requireLogin = useCallback(
    (notice: string) => {
      if (currentUser) {
        return true;
      }

      setAuthNotice(notice);
      return false;
    },
    [currentUser],
  );

  const registerForEvent = useCallback(
    async (
      eventId: string,
      nextAttendanceType: AttendanceType,
      status: "interested" | "going" = "going",
    ) => {
      if (!currentUser) {
        setAuthNotice("Log in to get your Tambike Pass.");
        return null;
      }

      const result = await registerForEventAction(eventId, {
        status,
        attendanceType: nextAttendanceType,
        clubName: currentUser.clubName,
      });
      applyState(result.state);
      setAttendanceType(nextAttendanceType);
      return result.passId;
    },
    [applyState, currentUser],
  );

  const createEventDraft = useCallback(
    async (input: CreateEventInput) => {
      if (currentUser?.role !== "organizer" || currentUser.verificationStatus !== "APPROVED") {
        return null;
      }

      const result = await createEventDraftAction(input);
      applyState(result.state);
      return result.event;
    },
    [applyState, currentUser],
  );

  const setScannerOutcome = useCallback((outcome: ScannerOutcome) => {
    setScannerOutcomeState(outcome);
  }, []);

  const scanPass = useCallback(
    async (eventId: string, qrToken: string, method: ScanMethod) => {
      const result = await scanPassAction(eventId, qrToken, method);
      applyState(result.state);
      setScannerOutcomeState(result.outcome);

      return result;
    },
    [applyState],
  );

  const approveVenueWithConditions = useCallback(async () => {
    const nextState = await approveVenueWithConditionsAction(
      "arai-hjc-charity-ride",
      venueConditions,
    );
    applyState(nextState);
    setVenueDecision("approved_with_conditions");
  }, [applyState, venueConditions]);

  const approvePublish = useCallback(async (eventId: string) => {
    const nextState = await approvePublishAction(eventId);
    applyState(nextState);
    setAdminDecision("published");
  }, [applyState]);

  const configureCheckIn = useCallback(
    async (eventId: string, input: CheckInConfiguration) => {
      const result = await configureCheckInAction(eventId, input);
      applyState(result.state);
      return result.settings;
    },
    [applyState],
  );

  const issueSelfCheckInQr = useCallback(
    async (eventId: string) => issueSelfCheckInQrAction(eventId),
    [],
  );

  const value = useMemo(
    () => ({
      role,
      users,
      currentUser,
      authNotice,
      setAuthNotice,
      loginWithPassword,
      signUpRider,
      logout,
      updateProfile,
      requireLogin,
      events,
      passes,
      checkInSettings,
      applyServerState: applyState,
      createEventDraft,
      attendanceType,
      passCreated,
      registerForEvent,
      scannerOutcome,
      setScannerOutcome,
      scanPass,
      configureCheckIn,
      issueSelfCheckInQr,
      checkedInCount,
      venueConditions,
      setVenueConditions,
      venueDecision,
      approveVenueWithConditions,
      adminDecision,
      approvePublish,
    }),
    [
      adminDecision,
      applyState,
      approvePublish,
      approveVenueWithConditions,
      attendanceType,
      authNotice,
      checkedInCount,
      checkInSettings,
      configureCheckIn,
      createEventDraft,
      currentUser,
      events,
      issueSelfCheckInQr,
      loginWithPassword,
      logout,
      passCreated,
      passes,
      registerForEvent,
      requireLogin,
      role,
      scannerOutcome,
      scanPass,
      setScannerOutcome,
      signUpRider,
      updateProfile,
      users,
      venueConditions,
      venueDecision,
    ],
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) {
    throw new Error("useDemo must be used within DemoProvider");
  }
  return context;
}
