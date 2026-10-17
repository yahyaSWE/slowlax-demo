import { z } from "zod";
import { DEMO_MODE } from "./demo-mode";
import { DEMO_FREE_MEMBERSHIP } from "./demo-offers";
import { assertAdmin } from "./admin";
import { getDb, transaction } from "./database";
import { DomainError } from "./db";
import { recordFreeMembershipNewsletter } from "./kit-newsletter-domain";
import { text } from "./validation";

export type FreeMembershipOffer = {
  name: "Bas"; slug: "bas"; priceOre: 0; description: string; updatedAt: string;
  groups: { id: number; name: string }[];
};
export type FreeMembershipSettings = {
  name: "Bas"; slug: "bas"; description: string; updatedAt: string; groupIds: number[];
  groups: { id: number; name: string; published: boolean }[]; memberCount: number;
};
export type StudentFreeMembership = { isMember: boolean; joinedAt: string | null; verified: boolean };
export type FreeMembershipJoinResult = StudentFreeMembership & { joined: boolean; newsletterQueued: boolean };
const positiveId = z.number().int().positive();
const inputSchema = z.object({description:text(12000,1),groupIds:z.array(positiveId).max(100),expectedUpdatedAt:z.iso.datetime()}).strict();

async function settingsSnapshot(): Promise<FreeMembershipSettings> {
  const row=await getDb().prepare("SELECT description,updated_at FROM free_membership_settings WHERE id=1").get();
  if(!row) throw new DomainError("Bas-medlemskapet är inte konfigurerat. Kontakta oss för hjälp.");
  const groups=(await getDb().prepare(`SELECT g.id,g.name,g.published FROM free_membership_groups fg
    JOIN membership_groups g ON g.id=fg.group_id ORDER BY g.name,g.id`).all()).map(group=>({id:Number(group.id),name:String(group.name),published:!!group.published}));
  const count=await getDb().prepare("SELECT COUNT(*) AS total FROM free_membership_members m JOIN users u ON u.id=m.user_id AND u.role='student'").get();
  return {name:"Bas",slug:"bas",description:String(row.description),updatedAt:String(row.updated_at),groups,groupIds:groups.map(group=>group.id),memberCount:Number(count?.total??0)};
}
/** Public Bas information never includes enrollment records or private groups. */
export async function getPublicFreeMembership(): Promise<FreeMembershipOffer> {
  if (DEMO_MODE) return DEMO_FREE_MEMBERSHIP;
  const row=await getDb().prepare("SELECT description,updated_at FROM free_membership_settings WHERE id=1").get();
  if(!row) throw new DomainError("Bas-medlemskapet är inte tillgängligt just nu.");
  const groups=(await getDb().prepare(`SELECT g.id,g.name FROM free_membership_groups fg
    JOIN membership_groups g ON g.id=fg.group_id WHERE g.published=1 ORDER BY g.name,g.id`).all()).map(group=>({id:Number(group.id),name:String(group.name)}));
  return {name:"Bas",slug:"bas",priceOre:0,description:String(row.description),updatedAt:String(row.updated_at),groups};
}
export async function getFreeMembershipSettings(actorId:number): Promise<FreeMembershipSettings> {
  await assertAdmin(actorId);
  return settingsSnapshot();
}
export async function saveFreeMembershipSettings(actorId:number,input:{description:string;groupIds:number[];expectedUpdatedAt:string}): Promise<FreeMembershipSettings> {
  const value=inputSchema.parse(input);
  return transaction(async()=>{
    await assertAdmin(actorId);
    if(new Set(value.groupIds).size!==value.groupIds.length) throw new DomainError("Välj varje grupp bara en gång.");
    const current=await settingsSnapshot();
    if(current.updatedAt!==value.expectedUpdatedAt) throw new DomainError("Bas-inställningarna har ändrats. Ladda om sidan innan du sparar igen.");
    for(const groupId of value.groupIds) if(!await getDb().prepare("SELECT id FROM membership_groups WHERE id=? AND published=1").get(groupId))
      throw new DomainError("Välj grupper som finns och är publicerade.");
    const updatedAt=new Date(Math.max(Date.now(),Date.parse(current.updatedAt)+1)).toISOString();
    const saved=await getDb().prepare("UPDATE free_membership_settings SET description=?,updated_at=? WHERE id=1 AND updated_at=?")
      .run(value.description,updatedAt,value.expectedUpdatedAt);
    if(!saved.changes) throw new DomainError("Bas-inställningarna har ändrats. Ladda om sidan.");
    await getDb().prepare("DELETE FROM free_membership_groups").run();
    for(const groupId of value.groupIds) await getDb().prepare("INSERT INTO free_membership_groups(group_id) VALUES(?)").run(groupId);
    return settingsSnapshot();
  });
}
export async function getStudentFreeMembership(userId:number): Promise<StudentFreeMembership> {
  positiveId.parse(userId);
  const row=await getDb().prepare(`SELECT u.role,u.email_verified_at,m.joined_at FROM users u
    LEFT JOIN free_membership_members m ON m.user_id=u.id WHERE u.id=?`).get(userId);
  const student=row?.role==="student";
  return {isMember:student&&row.joined_at!=null,joinedAt:student&&row.joined_at!=null?String(row.joined_at):null,verified:student&&row.email_verified_at!=null};
}
async function join(userId:number,requireVerified:boolean): Promise<FreeMembershipJoinResult> {
  positiveId.parse(userId);
  return transaction(async()=>{
    const user=await getDb().prepare("SELECT role,email_verified_at FROM users WHERE id=?").get(userId);
    if(user?.role!=="student") throw new DomainError("Logga in med ett elevkonto för att gå med i Bas.");
    if(requireVerified&&!user.email_verified_at) throw new DomainError("Verifiera din e-postadress innan du går med i Bas.");
    const inserted=await getDb().prepare("INSERT INTO free_membership_members(user_id,joined_at) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING").run(userId,new Date().toISOString());
    // An explicit replay can queue a missing intent after Kit is configured.
    // Existing sent/skipped/failed jobs are never reactivated by this operation.
    const newsletter=await recordFreeMembershipNewsletter(userId);
    return {...await getStudentFreeMembership(userId),joined:inserted.changes>0,newsletterQueued:newsletter.queued};
  });
}
/** Server-only registration hook: the new student may await verification. */
export async function enrollNewStudentInFreeMembership(userId:number): Promise<FreeMembershipJoinResult> { return join(userId,false); }
/** userId is always supplied from the authenticated session, never form data. */
export async function joinFreeMembership(userId:number): Promise<FreeMembershipJoinResult> { return join(userId,true); }
