export type GroupFields = { name: string; slug: string; description: string; courseIds: string[]; published: boolean; expectedUpdatedAt: string };
export type PlanFields = { groupId: string; groupIds: string[]; name: string; slug: string; description: string; price: string; vatPercent: string; interval: string; published: boolean; expectedUpdatedAt: string };
export type PostFields = { title: string; body: string; period: string; uploadIds: string[]; published: boolean; expectedUpdatedAt: string };
export type MembershipSettingsFields = { salesEnabled: boolean; terms: string; expectedUpdatedAt: string };
export type AssignmentFields = { email: string; groupId: string; expiresAt: string };
const text = (form: FormData, name: string) => typeof form.get(name) === "string" ? String(form.get(name)) : "";
const texts = (form: FormData, name: string) => form.getAll(name).filter((value): value is string => typeof value === "string");
export function groupFields(form: FormData): GroupFields { return { name: text(form,"name"), slug: text(form,"slug"), description: text(form,"description"), courseIds: texts(form,"courseId"), published: text(form,"published")==="on", expectedUpdatedAt: text(form,"expectedUpdatedAt") }; }
export function planFields(form: FormData): PlanFields { const groupIds = texts(form,"groupId").filter(Boolean); return { groupId:groupIds[0]??"",groupIds,name:text(form,"name"),slug:text(form,"slug"),description:text(form,"description"),price:text(form,"price"),vatPercent:text(form,"vatPercent"),interval:text(form,"interval"),published:text(form,"published")==="on",expectedUpdatedAt:text(form,"expectedUpdatedAt") }; }
export function postFields(form: FormData): PostFields { return { title:text(form,"title"),body:text(form,"body"),period:text(form,"period"),uploadIds:texts(form,"uploadId"),published:text(form,"published")==="on",expectedUpdatedAt:text(form,"expectedUpdatedAt") }; }
export function membershipSettingsFields(form: FormData): MembershipSettingsFields { return {salesEnabled:text(form,"salesEnabled")==="on",terms:text(form,"terms"),expectedUpdatedAt:text(form,"expectedUpdatedAt")}; }
export function assignmentFields(form: FormData): AssignmentFields { return {email:text(form,"email"),groupId:text(form,"groupId"),expiresAt:text(form,"expiresAt")}; }
