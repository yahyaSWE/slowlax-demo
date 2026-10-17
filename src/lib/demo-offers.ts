import { DEMO_COURSES } from "./demo-data";
import type { CourseBundle } from "./course-bundles";
import type { CourseSalesSettings } from "./course-sales";
import type { FreeMembershipOffer } from "./free-membership-domain";
import type { MembershipPlan, MembershipSettings } from "./membership-types";
import type { PurificationQuotaSettings, PurificationQuotaSource } from "./purification-domain";
import type { ReningOffer, ReningSettings } from "./rening-offers";

/** Presentation examples only: no customer records, contracts, or purchasable offers. */
export const DEMO_OFFER_DATE = "2026-10-17T00:00:00.000Z";
export const DEMO_GROUPS = [
  { id: 301, name: "Slowlax gemenskap" },
  { id: 302, name: "Fördjupning och aktieanalys" },
];
export const DEMO_FREE_MEMBERSHIP: FreeMembershipOffer = {
  name: "Bas", slug: "bas", priceOre: 0, updatedAt: DEMO_OFFER_DATE,
  description: "Bli en del av Slowlax gemenskap. Bas ger dig tillgång till vår öppna grupp, inspiration och nyhetsbrev om långsiktigt och ansvarsfullt sparande.",
  groups: [DEMO_GROUPS[0]],
};
export const DEMO_MEMBERSHIP_PLANS: MembershipPlan[] = [{
  id: 201, groupId: 301, groupIds: [301, 302], groups: DEMO_GROUPS,
  groupName: DEMO_GROUPS.map(group => group.name).join(" · "),
  name: "Premium", slug: "premium",
  description: "Fördjupa dina kunskaper med kurser, aktieanalys och en engagerad gemenskap. Exempelmedlemskapet samlar utbildning och rening av din portfölj på ett ställe.",
  priceOre: 29900, vatPercent: 25, interval: "month", published: true,
  createdAt: DEMO_OFFER_DATE, updatedAt: DEMO_OFFER_DATE,
}];
export const DEMO_MEMBERSHIP_SETTINGS: MembershipSettings = {
  salesEnabled: false, terms: "Detta är en presentation av Slowlax. Medlemskap kan inte tecknas och inga betalningar genomförs i denna demo.", updatedAt: DEMO_OFFER_DATE,
};
export const DEMO_BUNDLES: CourseBundle[] = [{
  id: 101, title: "Bas-kit", slug: "bas-kit",
  description: "Din start till ett medvetet sparande. Två kurser hjälper dig att förstå börsen och bygga en halal aktieportfölj. Paketet visar även hur tillgång till flera grupper och rening kan ingå.",
  priceOre: 149900, published: true, createdAt: DEMO_OFFER_DATE, updatedAt: DEMO_OFFER_DATE,
  courseIds: [1, 2], courses: DEMO_COURSES.filter(course => course.id === 1 || course.id === 2),
}];
export function demoCourseSalesDetails(courseId: number): (CourseSalesSettings & {
  groups: { id: number; name: string; accessDays: number | null }[];
}) | undefined {
  if (!DEMO_COURSES.some(course => course.id === courseId) && !DEMO_BUNDLES.some(bundle => bundle.id === courseId)) return undefined;
  const groups = courseId === 101 ? DEMO_GROUPS : [DEMO_GROUPS[0]];
  return {
    courseId, enabled: false, groupId: groups[0].id, groupIds: groups.map(group => group.id),
    groupAccessDays: null, vatPercent: 25, terms: DEMO_MEMBERSHIP_SETTINGS.terms, updatedAt: null,
    groups: groups.map(group => ({ ...group, accessDays: null })),
  };
}
export function demoPurificationQuota(sourceType: PurificationQuotaSource, sourceId: number): PurificationQuotaSettings {
  const credits = sourceType === "membership_plan" && sourceId === 201 ? 4 : sourceType === "course_bundle" && sourceId === 101 ? 2 : 0;
  return { sourceType, sourceId, credits, updatedAt: null };
}
export const DEMO_RENING_OFFERS: ReningOffer[] = [
  { id: 401, title: "Rening – 4 bolag", credits: 4, priceOre: 19900, vatPercent: 25, published: true, updatedAt: DEMO_OFFER_DATE },
  { id: 402, title: "Rening – 9 bolag", credits: 9, priceOre: 29900, vatPercent: 25, published: true, updatedAt: DEMO_OFFER_DATE },
  { id: 403, title: "Rening – 14 bolag", credits: 14, priceOre: 39900, vatPercent: 25, published: true, updatedAt: DEMO_OFFER_DATE },
];
export const DEMO_RENING_SETTINGS: ReningSettings = {
  salesEnabled: false, terms: "Erbjudandena visas som exempel i demonstrationen. Rening kan inte köpas eller skickas in här.", updatedAt: DEMO_OFFER_DATE,
};
