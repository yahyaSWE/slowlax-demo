import { z } from "zod";

const shortText = (max: number) => z.string().trim().max(max);
export const businessSettingsSchema = z.object({
  legalName: shortText(150).refine(value => !value || value.length >= 2, "Ange verksamhetens juridiska namn."),
  organizationNumber: shortText(30).regex(/^(?:\d{6}-\d{4})?$/, "Ange organisationsnummer som 123456-7890, eller lämna tomt tills uppgiften är verifierad."),
  cancellationHours: z.coerce.number().int().min(1).max(336),
  cancellationDetails: shortText(3000),
  courseAccessDescription: shortText(2000).min(1, "Beskriv hur länge kursåtkomsten gäller."),
  bookingRetention: shortText(2000),
  studentRetention: shortText(2000),
  legalBasis: shortText(4000),
  internationalTransfers: shortText(3000),
  additionalPrivacy: shortText(5000),
});
export type BusinessSettings = z.infer<typeof businessSettingsSchema>;

// Slowlax's public pages do not verify a legal name or organisation number.
// Leave those fields empty until the owner supplies the correct information.
export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  legalName: "",
  organizationNumber: "",
  cancellationHours: 24,
  cancellationDetails: "",
  courseAccessDescription: "Tillgång till kursmaterial visas i medlemsportalen för ditt konto. Eventuella tidsgränser anges vid tilldelningen eller i erbjudandets villkor.",
  bookingRetention: "",
  studentRetention: "",
  legalBasis: "",
  internationalTransfers: "",
  additionalPrivacy: "",
};

export const courseInformationSchema = z.object({
  audience: shortText(2000),
  prerequisites: shortText(2000),
  learningOutcomes: shortText(4000),
  completionRequirements: shortText(2000),
});
export type CourseInformation = z.infer<typeof courseInformationSchema>;
export const EMPTY_COURSE_INFORMATION: CourseInformation = {
  audience: "", prerequisites: "", learningOutcomes: "", completionRequirements: "",
};

export function cancellationText(hours: number) {
  return `Återbud ska lämnas minst ${hours} timmar före din bokade tid.`;
}

export function missingPrivacyInformation(value: BusinessSettings) {
  return [
    !value.legalBasis && "Rättslig grund",
    !value.studentRetention && "Lagring av elevuppgifter",
    !value.internationalTransfers && "Leverantörer och överföringar utanför EU/EES",
  ].filter((item): item is string => !!item);
}
