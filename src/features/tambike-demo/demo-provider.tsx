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
  configureCheckInAction,
  configureEventRosterAction,
  createEventDraftAction,
  deleteMemberMediaAction,
  getMemberProfileAction,
  getMemberProfileEditorAction,
  getEventRosterIdentityAction,
  issueSelfCheckInQrAction,
  listEventAttendeesAction,
  loginWithPasswordAction,
  logoutAction,
  reorderMotorcyclePhotosAction,
  registerForEventAction,
  scanPassAction,
  signUpRiderAction,
  updateProfileAction,
  updateMemberProfileAction,
  updateEventRosterIdentityAction,
  upsertMotorcycleAction,
} from "@/server/actions";
import type {
  MemberProfileEditorView,
  MemberProfileView,
  MotorcycleShowcase,
  EventAttendeeRosterPage,
  EventAttendeeSummary,
  RosterIdentity,
  UpdateMemberProfileInput,
  UpsertMotorcycleInput,
} from "@/features/member-profiles/types";
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
  getMemberProfile: (slug: string) => Promise<MemberProfileView>;
  getMemberProfileEditor: () => Promise<MemberProfileEditorView>;
  updateMemberProfile: (input: UpdateMemberProfileInput) => Promise<MemberProfileEditorView>;
  upsertMotorcycle: (input: UpsertMotorcycleInput) => Promise<MotorcycleShowcase>;
  deleteMemberMedia: (mediaId: string) => Promise<MemberProfileEditorView>;
  reorderMotorcyclePhotos: (mediaIds: string[]) => Promise<MemberProfileEditorView>;
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
    rosterIdentity?: RosterIdentity,
  ) => Promise<string | null>;
  configureEventRoster: (eventId: string, enabled: boolean) => Promise<EventAttendeeSummary>;
  listEventAttendees: (
    eventId: string,
    options?: { cursor?: string; limit?: number },
  ) => Promise<EventAttendeeRosterPage>;
  updateEventRosterIdentity: (
    eventId: string,
    rosterIdentity: RosterIdentity,
  ) => Promise<RosterIdentity>;
  getEventRosterIdentity: (eventId: string) => Promise<RosterIdentity>;
  scannerOutcome: ScannerOutcome;
  setScannerOutcome: (outcome: ScannerOutcome) => void;
  scanPass: (eventId: string, qrToken: string, method: ScanMethod) => Promise<ScanPassResult>;
  configureCheckIn: (
    eventId: string,
    input: CheckInConfiguration,
  ) => Promise<EventCheckInSettings>;
  issueSelfCheckInQr: (eventId: string) => Promise<SelfCheckInQr>;
  checkedInCount: number;
  adminDecision: "pending" | "published";
  approvePublish: (eventId: string) => Promise<void>;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function synchronizeAccountFromEditor(
  account: UserProfile,
  editor: MemberProfileEditorView,
): UserProfile {
  return {
    ...account,
    displayName: editor.displayName,
    area: editor.area,
  };
}

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

  const getMemberProfile = useCallback((slug: string) => getMemberProfileAction(slug), []);
  const getMemberProfileEditor = useCallback(() => getMemberProfileEditorAction(), []);
  const updateMemberProfile = useCallback(
    async (input: UpdateMemberProfileInput) => {
      const editor = await updateMemberProfileAction(input);
      if (currentUser) {
        const updatedAccount = synchronizeAccountFromEditor(currentUser, editor);
        setCurrentUser(updatedAccount);
        setUsers((accounts) => accounts.map((account) =>
          account.id === updatedAccount.id ? updatedAccount : account,
        ));
      }
      return editor;
    },
    [currentUser],
  );
  const upsertMotorcycle = useCallback(
    (input: UpsertMotorcycleInput) => upsertMotorcycleAction(input),
    [],
  );
  const deleteMemberMedia = useCallback(
    (mediaId: string) => deleteMemberMediaAction(mediaId),
    [],
  );
  const reorderMotorcyclePhotos = useCallback(
    (mediaIds: string[]) => reorderMotorcyclePhotosAction(mediaIds),
    [],
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
      rosterIdentity?: RosterIdentity,
    ) => {
      if (!currentUser) {
        setAuthNotice("Log in to get your Tambike Pass.");
        return null;
      }

      const result = await registerForEventAction(eventId, {
        status,
        attendanceType: nextAttendanceType,
        clubName: currentUser.clubName,
        rosterIdentity,
      });
      applyState(result.state);
      setAttendanceType(nextAttendanceType);
      return result.passId;
    },
    [applyState, currentUser],
  );

  const configureEventRoster = useCallback(
    (eventId: string, enabled: boolean) => configureEventRosterAction(eventId, { enabled }),
    [],
  );
  const listEventAttendees = useCallback(
    (eventId: string, options: { cursor?: string; limit?: number } = {}) =>
      listEventAttendeesAction(eventId, options),
    [],
  );
  const updateEventRosterIdentity = useCallback(
    async (eventId: string, rosterIdentity: RosterIdentity) =>
      (await updateEventRosterIdentityAction(eventId, { rosterIdentity })).rosterIdentity,
    [],
  );
  const getEventRosterIdentity = useCallback(
    async (eventId: string) =>
      (await getEventRosterIdentityAction(eventId)).rosterIdentity,
    [],
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
      getMemberProfile,
      getMemberProfileEditor,
      updateMemberProfile,
      upsertMotorcycle,
      deleteMemberMedia,
      reorderMotorcyclePhotos,
      requireLogin,
      events,
      passes,
      checkInSettings,
      applyServerState: applyState,
      createEventDraft,
      attendanceType,
      passCreated,
      registerForEvent,
      configureEventRoster,
      listEventAttendees,
      updateEventRosterIdentity,
      getEventRosterIdentity,
      scannerOutcome,
      setScannerOutcome,
      scanPass,
      configureCheckIn,
      issueSelfCheckInQr,
      checkedInCount,
      adminDecision,
      approvePublish,
    }),
    [
      adminDecision,
      applyState,
      approvePublish,
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
      configureEventRoster,
      listEventAttendees,
      updateEventRosterIdentity,
      getEventRosterIdentity,
      requireLogin,
      role,
      scannerOutcome,
      scanPass,
      setScannerOutcome,
      signUpRider,
      updateProfile,
      getMemberProfile,
      getMemberProfileEditor,
      updateMemberProfile,
      upsertMotorcycle,
      deleteMemberMedia,
      reorderMotorcyclePhotos,
      users,
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
