export type KitNewsletterSettings = {
  enabled: boolean;
  formId: string;
  tagId: string | null;
  doubleOptInConfirmed: boolean;
};

export type KitNewsletterStatus = "waiting_verification" | "pending" | "sending" | "sent" | "failed" | "skipped";

export type KitNewsletterJob = {
  id: string;
  userId: number;
  recipient: string;
  status: KitNewsletterStatus;
  attempts: number;
  createdAt: string;
  nextAttemptAt: string;
  sentAt: string | null;
  lastError: string | null;
};

export type KitNewsletterFormState = { error?: string; message?: string };
