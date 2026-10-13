import "server-only";
import { cache } from "react";
import { getMembershipSettings,getPublicPlan,getPublicPlanCourses } from "@/lib/memberships";
export const membershipSettingsForRender=cache(getMembershipSettings);
export const publicMembershipForRender=cache(getPublicPlan);
export const publicMembershipCoursesForRender=cache(getPublicPlanCourses);
