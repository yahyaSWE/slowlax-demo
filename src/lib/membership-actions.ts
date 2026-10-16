"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "./auth";
import { DomainError } from "./db";
import { field, idField, money } from "./validation";
import { stockholmToIso } from "./time";
import * as membership from "./memberships";
import type { ContentActionState } from "./content-action-state";
import { assignmentFields, groupFields, membershipSettingsFields, planFields, postFields, type AssignmentFields, type GroupFields, type MembershipSettingsFields, type PlanFields, type PostFields } from "./membership-form-state";

function message(error: unknown) {
  if (error instanceof DomainError) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message || "Kontrollera uppgifterna.";
  if (error instanceof Error && /UNIQUE constraint|SQLITE_CONSTRAINT_UNIQUE/.test(error.message)) return "Adressnamnet används redan. Välj ett annat.";
  return "Det gick inte att spara. Din inmatning finns kvar. Försök igen.";
}
function saved(path: string, formKey: string, success = "Ändringarna har sparats."): never {
  revalidatePath("/", "layout");
  redirect(`${path}?success=${encodeURIComponent(success)}&saved=${Date.now()}&savedForm=${encodeURIComponent(formKey)}`);
}
export async function saveGroupAction(_state: ContentActionState<GroupFields>, form: FormData): Promise<ContentActionState<GroupFields>> {
  const user = await requireAdmin(), values = groupFields(form);
  const oldId = field(form,"id") ? idField(form) : undefined;
  let id;
  try { id = await membership.saveGroup(user.id,oldId,{...values,courseIds:values.courseIds.map(Number),expectedUpdatedAt:oldId?values.expectedUpdatedAt:undefined}); }
  catch(error) { return {error:message(error),values}; }
  saved(`/admin/grupper/${id}`,`group-${oldId ?? "new"}`);
}
export async function savePlanAction(_state: ContentActionState<PlanFields>, form: FormData): Promise<ContentActionState<PlanFields>> {
  const user = await requireAdmin(), values = planFields(form);
  const oldId = field(form,"id") ? idField(form) : undefined;
  let id;
  try { id = await membership.savePlan(user.id,oldId,{...values,groupId:Number(values.groupId),groupIds:values.groupIds.map(Number),priceOre:money(values.price),vatPercent:Number(values.vatPercent) as 0|6|12|25,interval:values.interval as "month"|"year",expectedUpdatedAt:oldId?values.expectedUpdatedAt:undefined}); }
  catch(error) { return {error:message(error),values}; }
  saved(`/admin/medlemskap/${id}`,`plan-${oldId ?? "new"}`);
}
export async function saveGroupPostAction(_state: ContentActionState<PostFields>, form: FormData): Promise<ContentActionState<PostFields>> {
  const user=await requireAdmin(), values=postFields(form), groupId=idField(form,"groupId"), oldId=field(form,"id") ? idField(form) : undefined;
  let id;
  try { id=await membership.savePost(user.id,oldId,{...values,groupId,period:values.period||null,expectedUpdatedAt:oldId?values.expectedUpdatedAt:undefined}); }
  catch(error) { return {error:message(error),values}; }
  saved(`/admin/grupper/${groupId}/inlagg/${id}`,`post-${oldId ?? "new"}`);
}
export async function saveMembershipSettingsAction(_state: ContentActionState<MembershipSettingsFields>, form: FormData): Promise<ContentActionState<MembershipSettingsFields>> {
  const user=await requireAdmin(),values=membershipSettingsFields(form);
  try { await membership.saveMembershipSettings(user.id,values); }
  catch(error) { return {error:message(error),values}; }
  saved("/admin/medlemskap","membership-settings");
}
export async function assignGroupAction(_state: ContentActionState<AssignmentFields>,form:FormData):Promise<ContentActionState<AssignmentFields>> {
  const user=await requireAdmin(),values=assignmentFields(form);
  let expiresAt:string|null=null;
  try {
    if(values.expiresAt) {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(values.expiresAt)) throw new DomainError("Ange ett giltigt slutdatum.");
      try { expiresAt=new Date(Date.parse(stockholmToIso(`${values.expiresAt}T23:59`))+60000).toISOString(); }
      catch {throw new DomainError("Ange ett giltigt slutdatum i svensk tid.");}
    }
    await membership.assignGroup(user.id,{email:values.email,groupId:Number(values.groupId),expiresAt});
  } catch(error) {return{error:message(error),values};}
  saved(`/admin/grupper/${Number(values.groupId)}`,`assignment-${Number(values.groupId)}`,"Gruppåtkomsten har sparats.");
}
export async function removeGroupAssignmentAction(form:FormData) {
  const user=await requireAdmin(),groupId=idField(form,"groupId");
  try {await membership.removeAssignment(user.id,idField(form));}
  catch(error) {redirect(`/admin/grupper/${groupId}?error=${encodeURIComponent(message(error))}`);}
  saved(`/admin/grupper/${groupId}`,`assignment-${groupId}`,"Den manuella gruppåtkomsten har tagits bort.");
}
