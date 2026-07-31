import type {
  AccountRole,
  AccountStatus,
  VerificationStatus,
} from "../tambike-demo/types";

export type AdminUserAccount = {
  id: string;
  displayName: string;
  email: string;
  role: AccountRole;
  verificationStatus: VerificationStatus;
  accountStatus: AccountStatus;
  area: string;
  organizerProfileId?: string;
  suspendedAt?: string;
  suspendedReason?: string;
  updatedAt: string;
};

export type AccountAccessMutationInput = {
  reason: string;
  expectedUpdatedAt: string;
};
