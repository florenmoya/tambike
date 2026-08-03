export type LeadStatus = "NEW" | "CONTACTED" | "COMPLETED" | "CLOSED";

export type SubmitLeadInput = {
  name: string;
  phone: string;
  currentMotorcycle: string;
  interestedModel: string;
  preferredTime: string;
  consent: true;
  consentVersion: "test-ride-contact-v1";
  idempotencyKey: string;
  website: string;
};

export type LeadListQuery = {
  eventId?: string;
  status?: LeadStatus;
  cursor?: string;
  limit?: number;
};

export type LeadListItem = {
  id: string;
  eventId: string;
  eventTitle: string;
  name: string;
  maskedPhone: string;
  interestedModel: string;
  preferredTime: string;
  status: LeadStatus;
  createdAt: string;
  retentionExpiresAt: string;
  exportedAt?: string;
  updatedAt: string;
};

export type LeadListPage = {
  items: LeadListItem[];
  nextCursor?: string;
  total: number;
};

export type LeadContactView = {
  id: string;
  name: string;
  phone: string;
  currentMotorcycle: string;
  interestedModel: string;
  preferredTime: string;
  consentVersion: string;
  consentAt: string;
};

export type UpdateLeadStatusInput = {
  status: LeadStatus;
  expectedUpdatedAt: string;
};

export type LeadSubmissionResult = {
  leadId: string;
  updatedExisting: boolean;
};
