"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { LoaderCircle, Save } from "lucide-react";
import type { Course, UploadedMaterial } from "@/lib/types";
import type { AdminStudentChoice } from "@/lib/admin-students";
import type { MembershipGroup, MembershipPlan, MembershipPost, MembershipSettings } from "@/lib/membership-types";
import type { ContentActionState } from "@/lib/content-action-state";
import type { AssignmentFields, GroupFields, MembershipSettingsFields, PlanFields, PostFields } from "@/lib/membership-form-state";
import { assignGroupAction, saveGroupAction, saveGroupPostAction, saveMembershipSettingsAction, savePlanAction } from "@/lib/membership-actions";
import { useContentForm } from "@/lib/use-content-form";
import { GroupFileUpload } from "./group-file-upload";
import { StudentPicker } from "./student-picker";
import { Field } from "./common";
import "../memberships/memberships.css";

const GroupRichEditor=dynamic(()=>import("./group-rich-editor").then(module=>module.GroupRichEditor),{ssr:false,loading:()=> <p className="muted">Laddar texteditorn…</p>});
function useMemberForm<Values>(action:(state:ContentActionState<Values>,form:FormData)=>Promise<ContentActionState<Values>>,defaults:Values,key:string) {
  const form=useContentForm(action,defaults,key), search=useSearchParams(), saved=search.get("saved"), previous=useRef(saved);
  useEffect(()=>{if(saved&&saved!==previous.current&&search.get("savedForm")===key) form.setValues(defaults); previous.current=saved;},[saved,search,key,defaults,form.setValues]);
  return form;
}
function FormError({error,errorRef}:{error?:string;errorRef:React.RefObject<HTMLDivElement|null>}) {return error?<div className="notice notice-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>:null;}
function SaveButton({pending,busy=false,disabled=false,children}:{pending:boolean;busy?:boolean;disabled?:boolean;children:React.ReactNode}) {return <button type="submit" className="button button-primary" disabled={pending||busy||disabled}>{pending||busy?<><LoaderCircle size={17} className="admin-submit-spinner" aria-hidden="true"/>{busy?"Laddar upp…":"Sparar…"}</>:<><Save size={17} aria-hidden="true"/>{children}</>}</button>;}

export function GroupForm({group,courses}:{group?:MembershipGroup;courses:Course[]}) {
  const form=useMemberForm<GroupFields>(saveGroupAction,{name:group?.name??"",slug:group?.slug??"",description:group?.description??"",courseIds:group?.courseIds.map(String)??[],published:group?.published??false,expectedUpdatedAt:group?.updatedAt??""},`group-${group?.id??"new"}`);
  const change=(key:keyof GroupFields,value:string|boolean|string[])=>form.setValues(current=>({...current,[key]:value}));
  return <form action={form.action} className="stack" onSubmit={form.onSubmit} aria-busy={form.pending}>
    {group&&<input type="hidden" name="id" value={group.id}/>}<input type="hidden" name="expectedUpdatedAt" value={form.values.expectedUpdatedAt}/><FormError error={form.error} errorRef={form.errorRef}/>
    <fieldset disabled={form.pending} className="stack content-form-fields"><legend className="sr-only">Gruppens uppgifter</legend>
      <div className="form-grid"><Field label="Gruppnamn" name="group-name"><input id="group-name" name="name" required minLength={2} maxLength={150} value={form.values.name} onChange={event=>change("name",event.target.value)}/></Field><Field label="Adressnamn" name="group-slug" help="Lämna tomt för att skapa adressnamnet automatiskt."><input id="group-slug" name="slug" maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.values.slug} onChange={event=>change("slug",event.target.value)}/></Field></div>
      <Field label="Gruppbeskrivning" name="group-description"><textarea id="group-description" name="description" rows={4} maxLength={20000} value={form.values.description} onChange={event=>change("description",event.target.value)}/></Field>
      <div className="stack"><h3>Kurser som ingår</h3><p className="muted small">Gruppens medlemmar får tillgång till de publicerade kurser du väljer. Du kan också skapa en grupp med bara gruppmaterial.</p><div className="membership-course-options">{courses.map(course=><label className="form-check" key={course.id}><input type="checkbox" name="courseId" value={course.id} checked={form.values.courseIds.includes(String(course.id))} onChange={event=>change("courseIds",event.target.checked?[...form.values.courseIds,String(course.id)]:form.values.courseIds.filter(id=>id!==String(course.id)))}/><span>{course.title}{!course.published&&" (utkast)"}</span></label>)}</div>{!courses.length&&<p className="muted">Inga kurser har skapats ännu.</p>}</div>
      <label className="form-check"><input type="checkbox" name="published" checked={form.values.published} onChange={event=>change("published",event.target.checked)}/><span>Visa gruppen för dess medlemmar</span></label><p className="small muted">Avmarkera för att arbeta i utkast. Det döljer gruppen, materialet och gruppens kursåtkomst för elever tills du publicerar igen.</p>
    </fieldset><div><SaveButton pending={form.pending}>{group?"Spara grupp":"Skapa grupp"}</SaveButton></div>
  </form>;
}

export function MembershipPlanForm({plan,groups}:{plan?:MembershipPlan;groups:MembershipGroup[]}) {
  const form=useMemberForm<PlanFields>(savePlanAction,{groupId:String(plan?.groupId??groups[0]?.id??""),name:plan?.name??"",slug:plan?.slug??"",description:plan?.description??"",price:plan?String(plan.priceOre/100):"",vatPercent:String(plan?.vatPercent??25),interval:plan?.interval??"month",published:plan?.published??false,expectedUpdatedAt:plan?.updatedAt??""},`plan-${plan?.id??"new"}`);
  const change=(key:keyof PlanFields,value:string|boolean)=>form.setValues(current=>({...current,[key]:value}));
  return <form action={form.action} className="stack" onSubmit={form.onSubmit} aria-busy={form.pending}>
    {plan&&<input type="hidden" name="id" value={plan.id}/>}<input type="hidden" name="expectedUpdatedAt" value={form.values.expectedUpdatedAt}/><FormError error={form.error} errorRef={form.errorRef}/>
    <fieldset disabled={form.pending} className="stack content-form-fields"><legend className="sr-only">Medlemskapets uppgifter</legend>
      <Field label="Grupp som ingår" name="plan-group" help="Gruppen styr kursåtkomst och material. När en betalning har påbörjats är kopplingen låst."><select id="plan-group" name="groupId" required value={form.values.groupId} onChange={event=>change("groupId",event.target.value)}><option value="">Välj grupp</option>{groups.map(group=><option value={group.id} key={group.id}>{group.name}{!group.published&&" (utkast)"}</option>)}</select></Field>
      <div className="form-grid"><Field label="Medlemskapets namn" name="plan-name"><input id="plan-name" name="name" required minLength={2} maxLength={150} value={form.values.name} onChange={event=>change("name",event.target.value)}/></Field><Field label="Adressnamn" name="plan-slug"><input id="plan-slug" name="slug" maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.values.slug} onChange={event=>change("slug",event.target.value)}/></Field></div>
      <Field label="Beskrivning för besökare" name="plan-description"><textarea id="plan-description" name="description" maxLength={20000} rows={5} value={form.values.description} onChange={event=>change("description",event.target.value)}/></Field>
      <div className="membership-plan-numbers"><Field label="Pris inklusive moms (kr)" name="plan-price"><input id="plan-price" name="price" required inputMode="decimal" value={form.values.price} onChange={event=>change("price",event.target.value)}/></Field><Field label="Moms (%)" name="plan-vat"><select id="plan-vat" name="vatPercent" value={form.values.vatPercent} onChange={event=>change("vatPercent",event.target.value)}>{[25,12,6,0].map(vat=><option key={vat} value={vat}>{vat} %</option>)}</select></Field><Field label="Betalningsintervall" name="plan-interval"><select id="plan-interval" name="interval" value={form.values.interval} onChange={event=>change("interval",event.target.value)}><option value="month">Varje månad</option><option value="year">Varje år</option></select></Field></div>
      <p className="small muted">Ändrade priser och intervall gäller nya abonnemang. Befintliga abonnemang behåller sitt avtalade pris.</p>
      <label className="form-check"><input type="checkbox" name="published" checked={form.values.published} onChange={event=>change("published",event.target.checked)}/><span>Publicera erbjudandet</span></label><p className="small muted">För nya köp behöver även gruppen vara publicerad och försäljningen vara aktiverad under Medlemskap.</p>
    </fieldset><div><SaveButton pending={form.pending}>{plan?"Spara medlemskap":"Skapa medlemskap"}</SaveButton></div>
  </form>;
}

export function GroupPostForm({groupId,post}:{groupId:number;post?:MembershipPost}) {
  const form=useMemberForm<PostFields>(saveGroupPostAction,{title:post?.title??"",body:post?.body?JSON.stringify(post.body):"",period:post?.period??"",uploadIds:post?.uploads.map(file=>file.id)??[],published:post?.published??false,expectedUpdatedAt:post?.updatedAt??""},`post-${post?.id??"new"}`);
  const [files,setFiles]=useState<UploadedMaterial[]>(post?.uploads??[]),[imageBusy,setImageBusy]=useState(false),[fileBusy,setFileBusy]=useState(false),busy=imageBusy||fileBusy;
  const change=(key:keyof PostFields,value:string|boolean|string[])=>form.setValues(current=>({...current,[key]:value}));
  return <form action={form.action} className="stack" aria-busy={form.pending||busy} onSubmit={event=>{if(busy)event.preventDefault();else form.onSubmit();}}>
    <input type="hidden" name="groupId" value={groupId}/>{post&&<input type="hidden" name="id" value={post.id}/>}<input type="hidden" name="expectedUpdatedAt" value={form.values.expectedUpdatedAt}/><input type="hidden" name="body" value={form.values.body}/>{form.values.uploadIds.map(id=><input type="hidden" name="uploadId" value={id} key={id}/>)}<FormError error={form.error} errorRef={form.errorRef}/>
    <fieldset disabled={form.pending||busy} className="stack content-form-fields"><legend className="sr-only">Gruppinläggets innehåll</legend>
      <div className="form-grid"><Field label="Rubrik" name="post-title"><input id="post-title" name="title" required minLength={2} maxLength={180} value={form.values.title} onChange={event=>change("title",event.target.value)}/></Field><Field label="Månad (valfri)" name="post-period" help="Gör det enkelt att hitta exempelvis månadens matplan."><input id="post-period" name="period" type="month" value={form.values.period} onInput={event=>change("period",event.currentTarget.value)} onChange={event=>change("period",event.target.value)}/></Field></div>
      <div className="stack"><h3>Innehåll</h3><GroupRichEditor groupId={groupId} value={form.values.body} onChange={value=>change("body",value)} disabled={form.pending||fileBusy} onBusyChange={setImageBusy}/></div>
      <div className="stack"><h3>PDF och Word-filer</h3><GroupFileUpload groupId={groupId} value={files} onChange={next=>{setFiles(next);change("uploadIds",next.map(file=>file.id));}} disabled={form.pending||imageBusy} onBusyChange={setFileBusy}/></div>
      <label className="form-check"><input type="checkbox" name="published" checked={form.values.published} onChange={event=>change("published",event.target.checked)}/><span>Publicera för gruppens medlemmar</span></label><p className="small muted">Innehåll och bilagor är privata. Utkast kan bara ses av admin.</p>
    </fieldset><div><SaveButton pending={form.pending} busy={busy}>{post?"Spara inlägg":"Skapa inlägg"}</SaveButton></div>
  </form>;
}

export function MembershipSettingsForm({settings}:{settings:MembershipSettings}) {
  const form=useMemberForm<MembershipSettingsFields>(saveMembershipSettingsAction,{salesEnabled:settings.salesEnabled,terms:settings.terms,expectedUpdatedAt:settings.updatedAt},"membership-settings");
  return <form action={form.action} className="stack" onSubmit={form.onSubmit} aria-busy={form.pending}><input type="hidden" name="expectedUpdatedAt" value={form.values.expectedUpdatedAt}/><FormError error={form.error} errorRef={form.errorRef}/><fieldset className="stack content-form-fields" disabled={form.pending}><legend className="sr-only">Försäljning och villkor</legend><Field label="Villkor för abonnemang" name="membership-terms" help="Ange vad som ingår, betalningsintervall och regler för uppsägning. Eleven godkänner dessa innan betalning."><textarea id="membership-terms" name="terms" rows={7} maxLength={20000} value={form.values.terms} onChange={event=>form.setValues(current=>({...current,terms:event.target.value}))}/></Field><label className="form-check"><input type="checkbox" name="salesEnabled" checked={form.values.salesEnabled} onChange={event=>form.setValues(current=>({...current,salesEnabled:event.target.checked}))}/><span>Öppna för nya abonnemang på hemsidan</span></label><p className="small muted">När försäljningen är avstängd kan du fortsätta skapa utkast och tilldela grupper manuellt. Befintliga abonnemang fortsätter löpa och behöver hanteras separat.</p></fieldset><div><SaveButton pending={form.pending}>Spara försäljning och villkor</SaveButton></div></form>;
}

export function GroupAssignmentForm({groupId,students}:{groupId:number;students:AdminStudentChoice[]}) {
  const form=useMemberForm<AssignmentFields>(assignGroupAction,{email:"",groupId:String(groupId),expiresAt:""},`assignment-${groupId}`);
  const selected=students.find(student=>student.email.toLowerCase()===form.values.email.toLowerCase());
  return <form action={form.action} className="stack" onSubmit={form.onSubmit} aria-busy={form.pending}><input type="hidden" name="groupId" value={groupId}/><input type="hidden" name="email" value={form.values.email}/><FormError error={form.error} errorRef={form.errorRef}/><fieldset className="stack content-form-fields" disabled={form.pending}><legend className="sr-only">Tilldela gruppåtkomst</legend><Field label="Elev" name="member-student" help="Alla registrerade elever visas. E-postadressen måste vara verifierad för att åtkomst ska kunna tilldelas."><StudentPicker id="member-student" students={students} value={form.values.email} disabled={form.pending} onChange={email=>form.setValues(current=>({...current,email}))}/></Field><Field label="Till och med (valfritt)" name="member-expires" help="Tomt innebär obegränsad manuell gruppåtkomst. Slutdatum gäller hela dagen i svensk tid."><input id="member-expires" name="expiresAt" type="date" value={form.values.expiresAt} onInput={event=>{const expiresAt=event.currentTarget.value;form.setValues(current=>({...current,expiresAt}));}} onChange={event=>form.setValues(current=>({...current,expiresAt:event.target.value}))}/></Field></fieldset><div><SaveButton pending={form.pending} disabled={!selected?.emailVerified}>Tilldela gruppåtkomst</SaveButton></div></form>;
}
