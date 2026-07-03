"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { demoEvents, mockUsers } from "./data";
import type {
  AttendanceType,
  CreateEventInput,
  Event,
  ProfileInput,
  Role,
  ScannerOutcome,
  SignupInput,
  UserProfile,
} from "./types";

interface DemoContextValue {
  role: Role;
  users: UserProfile[];
  currentUser: UserProfile | null;
  authNotice: string;
  setAuthNotice: (notice: string) => void;
  loginAsUser: (userId: string) => UserProfile | null;
  signUpRider: (input: SignupInput) => UserProfile;
  logout: () => void;
  updateProfile: (input: ProfileInput) => void;
  requireLogin: (notice: string) => boolean;
  events: Event[];
  createEventDraft: (input: CreateEventInput) => Event | null;
  attendanceType: AttendanceType;
  passCreated: boolean;
  registerForEvent: (attendanceType: AttendanceType) => boolean;
  scannerOutcome: ScannerOutcome;
  setScannerOutcome: (outcome: ScannerOutcome) => void;
  checkedInCount: number;
  venueConditions: string;
  setVenueConditions: (conditions: string) => void;
  venueDecision: "pending" | "approved_with_conditions";
  approveVenueWithConditions: () => void;
  adminDecision: "pending" | "published";
  approvePublish: () => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);
const USERS_STORAGE_KEY = "tambike-demo-users";
const CURRENT_USER_STORAGE_KEY = "tambike-demo-current-user";
const SOURCED_POSTER_BY_TYPE: Record<Event["type"], string> = {
  Tambike: "/demo/poster-tambike-cafe-classico.jpg",
  "Bike Night": "/demo/poster-tambike-cafe-classico.jpg",
  "Coffee Ride": "/demo/poster-tambike-cafe-classico.jpg",
  "Club EB": "/demo/poster-tambike-cafe-classico.jpg",
  "Brand Event": "/demo/poster-ducati-track-day.jpg",
  "Test Ride": "/demo/poster-ducati-track-day.jpg",
  "Charity Ride": "/demo/poster-arai-hjc-charity-ride.jpg",
  "Track Day": "/demo/poster-ducati-track-day.jpg",
  "Endurance Ride": "/demo/poster-mandirigma-endutour-v5.jpg",
  "Moto Expo": "/demo/poster-makina-moto-expo-cebu.jpg",
  Race: "/demo/poster-motoir-round-4.jpg",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<UserProfile[]>(mockUsers);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [hasRestoredSession, setHasRestoredSession] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [events, setEvents] = useState<Event[]>(demoEvents);
  const [attendanceType, setAttendanceType] = useState<AttendanceType>("direct");
  const [passCreated, setPassCreated] = useState(false);
  const [scannerOutcome, setScannerOutcomeState] = useState<ScannerOutcome>("idle");
  const [checkedInCount, setCheckedInCount] = useState(68);
  const [venueConditions, setVenueConditions] = useState(
    "Max 120 riders. Parking marshals required. Quiet exit after 10 PM.",
  );
  const [venueDecision, setVenueDecision] = useState<"pending" | "approved_with_conditions">(
    "pending",
  );
  const [adminDecision, setAdminDecision] = useState<"pending" | "published">("pending");

  const role: Role = currentUser?.role ?? "guest";

  useEffect(() => {
    let isActive = true;

    window.queueMicrotask(() => {
      if (!isActive) {
        return;
      }

      try {
        const savedUsers = window.localStorage.getItem(USERS_STORAGE_KEY);
        const nextUsers = savedUsers ? (JSON.parse(savedUsers) as UserProfile[]) : mockUsers;
        const savedCurrentUserId = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);

        setUsers(nextUsers);
        setCurrentUser(
          nextUsers.find((candidate) => candidate.id === savedCurrentUserId) ?? null,
        );
      } catch {
        setUsers(mockUsers);
        setCurrentUser(null);
      } finally {
        setHasRestoredSession(true);
      }
    });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!hasRestoredSession) {
      return;
    }

    window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  }, [hasRestoredSession, users]);

  useEffect(() => {
    if (!hasRestoredSession) {
      return;
    }

    if (currentUser) {
      window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, currentUser.id);
      return;
    }

    window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
  }, [currentUser, hasRestoredSession]);

  const loginAsUser = useCallback(
    (userId: string) => {
      const user = users.find((candidate) => candidate.id === userId) ?? null;
      setCurrentUser(user);
      setAuthNotice("");
      return user;
    },
    [users],
  );

  const signUpRider = useCallback((input: SignupInput) => {
    const newUser: UserProfile = {
      id: `user-${slugify(input.email || input.displayName)}`,
      displayName: input.displayName.trim(),
      email: input.email.trim().toLowerCase(),
      role: "rider",
      verificationStatus: "UNVERIFIED",
      area: input.area.trim(),
      bikeModel: input.bikeModel?.trim() || undefined,
      clubName: input.clubName?.trim() || undefined,
      joinedAt: "July 2, 2026",
    };

    setUsers((existingUsers) => [...existingUsers, newUser]);
    setCurrentUser(newUser);
    setAuthNotice("");
    return newUser;
  }, []);

  const logout = useCallback(() => {
    setCurrentUser(null);
    setPassCreated(false);
    setAuthNotice("");
  }, []);

  const updateProfile = useCallback((input: ProfileInput) => {
    setCurrentUser((user) => {
      if (!user) {
        return user;
      }

      const updatedUser = {
        ...user,
        displayName: input.displayName.trim(),
        area: input.area.trim(),
        bikeModel: input.bikeModel?.trim() || undefined,
        clubName: input.clubName?.trim() || undefined,
      };

      setUsers((existingUsers) =>
        existingUsers.map((existingUser) =>
          existingUser.id === updatedUser.id ? updatedUser : existingUser,
        ),
      );

      return updatedUser;
    });
  }, []);

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

  const registerForEvent = useCallback((nextAttendanceType: AttendanceType) => {
    if (!currentUser) {
      setAuthNotice("Log in to get your Tambike Pass.");
      return false;
    }

    setAttendanceType(nextAttendanceType);
    setPassCreated(true);
    return true;
  }, [currentUser]);

  const createEventDraft = useCallback(
    (input: CreateEventInput) => {
      if (
        currentUser?.role !== "organizer" ||
        currentUser.verificationStatus !== "APPROVED"
      ) {
        return null;
      }

      const baseId = slugify(input.title);
      const existingIds = new Set(events.map((event) => event.id));
      const eventId = existingIds.has(baseId) ? `${baseId}-${events.length + 1}` : baseId;
      const expectedRiders = Math.max(1, input.expectedRiders);
      const createdEvent: Event = {
        id: eventId,
        title: input.title.trim(),
        type: input.type,
        status: "PENDING_VENUE_APPROVAL",
        organizerId: currentUser.organizerProfileId ?? "arai-hjc-riders",
        venueId: input.venueId,
        poster: SOURCED_POSTER_BY_TYPE[input.type],
        date: input.date.trim(),
        time: input.time.trim(),
        area: input.area.trim(),
        shortDescription: `${input.title.trim()} is an organizer draft awaiting venue approval.`,
        whatHappens:
          "Organizer-created draft that follows the MVP create-event flow before persistence is connected.",
        going: 0,
        interested: 0,
        expectedRiders,
        perkPreview: input.perkPreview.trim(),
        tags: [input.type, "Draft", "Venue approval"],
        riskFlags: expectedRiders >= 50 ? ["Expected riders need review"] : ["Standard venue approval"],
        rules: ["Helmet required", "Respect venue rules", "No revving", "Follow marshals"],
        perks: [
          {
            id: "mock-perk",
            type: "Check-in perk",
            description: input.perkPreview.trim(),
          },
        ],
      };

      setEvents((existingEvents) => [createdEvent, ...existingEvents]);
      return createdEvent;
    },
    [currentUser, events],
  );

  const setScannerOutcome = useCallback((outcome: ScannerOutcome) => {
    setScannerOutcomeState(outcome);
    if (outcome === "valid") {
      setCheckedInCount((count) => Math.max(count, 69));
    }
  }, []);

  const approveVenueWithConditions = useCallback(() => {
    setVenueDecision("approved_with_conditions");
  }, []);

  const approvePublish = useCallback(() => {
    setAdminDecision("published");
  }, []);

  const value = useMemo(
    () => ({
      role,
      users,
      currentUser,
      authNotice,
      setAuthNotice,
      loginAsUser,
      signUpRider,
      logout,
      updateProfile,
      requireLogin,
      events,
      createEventDraft,
      attendanceType,
      passCreated,
      registerForEvent,
      scannerOutcome,
      setScannerOutcome,
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
      approvePublish,
      approveVenueWithConditions,
      attendanceType,
      authNotice,
      checkedInCount,
      createEventDraft,
      currentUser,
      events,
      loginAsUser,
      logout,
      passCreated,
      registerForEvent,
      requireLogin,
      role,
      scannerOutcome,
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
