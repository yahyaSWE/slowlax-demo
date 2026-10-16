import type { ProductRichTextDocument } from "./product-rich-text";
import type { Course, UploadedMaterial } from "./types";
import type { StudentAccessState } from "./student-access";

export type MembershipGroup = {
  id: number; name: string; slug: string; description: string; published: boolean;
  createdAt: string; updatedAt: string; courseIds: number[]; courses: Course[];
  access?: StudentAccessState;
};
export type MembershipPlan = {
  id: number; groupId: number; groupName: string; name: string; slug: string;
  groupIds: number[]; groups: { id: number; name: string }[];
  description: string; priceOre: number; vatPercent: 0 | 6 | 12 | 25;
  interval: "month" | "year"; published: boolean; createdAt: string; updatedAt: string;
};
export type MembershipAssignment = {
  id: number; userId: number; groupId: number; name: string; email: string;
  groupName: string; expiresAt: string | null; createdAt: string; updatedAt: string;
};
export type MembershipPost = {
  id: number; groupId: number; title: string; body: ProductRichTextDocument | null;
  period: string | null; published: boolean; createdAt: string; updatedAt: string;
  uploads: UploadedMaterial[];
};
export type MembershipSettings = { salesEnabled: boolean; terms: string; updatedAt: string };
export type Group = MembershipGroup;
export type Plan = MembershipPlan;
export type Assignment = MembershipAssignment;
export type Post = MembershipPost;

export type MembershipGroupInput = {
  name: string; slug: string; description: string; published: boolean; courseIds: number[];
  expectedUpdatedAt?: string;
};
export type MembershipPlanInput = {
  groupId: number; groupIds?: number[]; name: string; slug: string; description: string; priceOre: number;
  vatPercent: 0 | 6 | 12 | 25; interval: "month" | "year"; published: boolean;
  expectedUpdatedAt?: string;
};
export type MembershipPostInput = {
  groupId: number; title: string; body: string | ProductRichTextDocument | null;
  period: string | null; published: boolean; uploadIds: string[]; expectedUpdatedAt?: string;
};
