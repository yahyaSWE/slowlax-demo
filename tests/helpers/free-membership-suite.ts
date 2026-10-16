import { after,before,test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createFirstAdmin,createUser,getDb,hasCourseAccess,type User } from "../../src/lib/db";
import { PostgresDatabaseAdapter } from "../../src/lib/postgres-database";
import { pglitePostgres } from "./pglite-postgres";
import { assignGroup,getAccessibleGroup,getPortalGroups,saveGroup } from "../../src/lib/memberships";
import { getStudentGroupAccessStates } from "../../src/lib/student-access";
import { enrollNewStudentInFreeMembership,getFreeMembershipSettings,getPublicFreeMembership,getStudentFreeMembership,joinFreeMembership,saveFreeMembershipSettings } from "../../src/lib/free-membership-domain";
import { getCourseCertificateSettings,issueCourseCertificate,saveCourseCertificateSettings } from "../../src/lib/course-certificates";

const token=()=>randomBytes(10).toString("hex");
const now=()=>new Date().toISOString();
export function freeMembershipSuite(provider:"sqlite"|"postgres") {
  for(const key of ["TURSO_DATABASE_URL","TURSO_AUTH_TOKEN","VERCEL","SUPABASE_AUTH_ENABLED","KIT_API_KEY"]) delete process.env[key];
  process.env.SUPABASE_DATABASE_ENABLED=provider==="postgres"?"true":"false";
  process.env.DATABASE_URL="postgres://test:test@localhost/test";
  let directory:string|undefined;
  let admin:User,student:User,other:User;
  before(async()=>{
    if(provider==="postgres") {const adapter=getDb() as PostgresDatabaseAdapter;await pglitePostgres(adapter);await adapter.migrate();}
    else {directory=await mkdtemp(join(tmpdir(),"slowlax-free-membership-"));process.env.TIBB_DATABASE_PATH=join(directory,"membership.sqlite");}
    admin=await createFirstAdmin({name:"Bas teacher",email:"bas-admin@example.test",passwordHash:"fixture"});
    student=await createUser({name:"Bas student",email:"bas-student@example.test",role:"student",passwordHash:"fixture"});
    other=await createUser({name:"Other student",email:"bas-other@example.test",role:"student",passwordHash:"fixture"});
    await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id IN (?,?)").run(now(),student.id,other.id);
  });
  after(async()=>{await getDb().close();if(directory)await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:200});});
  async function courseFixture(){
    const stamp=now(), id=Number((await getDb().prepare("INSERT INTO courses(title,slug,published,created_at,updated_at) VALUES(?,?,1,?,?)")
      .run(`Free course ${token()}`,`free-course-${token()}`,stamp,stamp)).lastInsertRowid);
    const lessonId=Number((await getDb().prepare("INSERT INTO lessons(course_id,title) VALUES(?,?)").run(id,"Free lesson")).lastInsertRowid);
    return {id,lessonId};
  }
  const groupFixture=(courses:number[]=[],published=true)=>saveGroup(admin.id,undefined,{name:`Group ${token()}`,slug:`free-group-${token()}`,description:"Private group content",published,courseIds:courses});
  async function configure(groupIds:number[],description="Free newsletter and community"){
    const current=await getFreeMembershipSettings(admin.id);
    return saveFreeMembershipSettings(admin.id,{description,groupIds,expectedUpdatedAt:current.updatedAt});
  }
  test(`${provider}: Bas is a real public zero-cost membership without groups or Stripe; admin settings use CAS`,async()=>{
    const offer=await getPublicFreeMembership();
    assert.equal(offer.name,"Bas");assert.equal(offer.slug,"bas");assert.equal(offer.priceOre,0);assert.deepEqual(offer.groups,[]);
    assert.equal((await getStudentFreeMembership(student.id)).isMember,false);
    assert.equal(Number((await getDb().prepare("SELECT COUNT(*) AS total FROM free_membership_members").get())?.total),0);
    const first=await groupFixture(),second=await groupFixture(),draft=await groupFixture([],false);
    const settings=await getFreeMembershipSettings(admin.id);
    await assert.rejects(getFreeMembershipSettings(student.id),/behörighet|administration/);
    await assert.rejects(saveFreeMembershipSettings(student.id,{description:"Attempt",groupIds:[first],expectedUpdatedAt:settings.updatedAt}),/behörighet|administration/);
    await assert.rejects(configure([draft]),/publicerade/);
    await assert.rejects(configure([999999]),/publicerade/);
    await assert.rejects(configure([first,first]),/bara en gång/);
    const results=await Promise.allSettled([
      saveFreeMembershipSettings(admin.id,{description:"First edit",groupIds:[first],expectedUpdatedAt:settings.updatedAt}),
      saveFreeMembershipSettings(admin.id,{description:"Second edit",groupIds:[second],expectedUpdatedAt:settings.updatedAt}),
    ]);
    assert.equal(results.filter(result=>result.status==="fulfilled").length,1);assert.equal(results.filter(result=>result.status==="rejected").length,1);
    const saved=await getFreeMembershipSettings(admin.id);assert.ok(saved.updatedAt>settings.updatedAt);
    const published=await getPublicFreeMembership();assert.equal(published.groups.length,1);
    assert.ok(!Object.hasOwn(published,"memberCount"));assert.ok(!Object.hasOwn(published,"userId"));
    await getDb().prepare("UPDATE membership_groups SET published=0 WHERE id=?").run(saved.groupIds[0]);
    assert.deepEqual((await getPublicFreeMembership()).groups,[]);
    assert.equal((await getFreeMembershipSettings(admin.id)).groups[0].published,false);
    await configure([]);
  });
  test(`${provider}: registration can enroll before verification but content and self-join require a verified student`,async()=>{
    const course=await courseFixture(),group=await groupFixture([course.id]);await configure([group]);
    const user=await createUser({name:"New unverified",email:`new-${token()}@example.test`,role:"student",passwordHash:"fixture"});
    const enrolled=await enrollNewStudentInFreeMembership(user.id);assert.equal(enrolled.joined,true);assert.equal(enrolled.verified,false);
    assert.equal((await getStudentFreeMembership(user.id)).isMember,true);
    assert.equal(await getAccessibleGroup(user.id,group),undefined);assert.equal(await hasCourseAccess(user.id,course.id),false);
    await assert.rejects(joinFreeMembership(user.id),/Verifiera/);
    await assert.rejects(joinFreeMembership(admin.id),/elevkonto/);
    await assert.rejects(enrollNewStudentInFreeMembership(admin.id),/elevkonto/);
    await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now(),user.id);
    const replay=await joinFreeMembership(user.id);assert.equal(replay.joined,false);assert.equal(replay.joinedAt,enrolled.joinedAt);
    assert.ok(await getAccessibleGroup(user.id,group));assert.equal(await hasCourseAccess(user.id,course.id),true);
    await getDb().prepare("UPDATE courses SET published=0 WHERE id=?").run(course.id);
    assert.equal(await hasCourseAccess(user.id,course.id),false);
    await configure([]);
  });
  test(`${provider}: later group links reach existing Bas members; removing Bas preserves independent grants`,async()=>{
    const original=await getStudentFreeMembership(student.id);assert.equal(original.isMember,false);
    const joins=await Promise.all([joinFreeMembership(student.id),joinFreeMembership(student.id)]);
    assert.equal(joins.filter(join=>join.joined).length,1);assert.equal(joins[0].joinedAt,joins[1].joinedAt);
    const course=await courseFixture(),secondCourse=await courseFixture();
    const first=await groupFixture([course.id]),second=await groupFixture([secondCourse.id]);
    await configure([first,second]);
    const portal=await getPortalGroups(student.id);assert.ok(portal.some(group=>group.id===first));assert.ok(portal.some(group=>group.id===second));
    assert.equal(await hasCourseAccess(student.id,course.id),true);assert.equal(await hasCourseAccess(student.id,secondCourse.id),true);
    assert.equal(await getAccessibleGroup(other.id,first),undefined);
    await assignGroup(admin.id,{email:student.email,groupId:first,expiresAt:null});
    await getDb().prepare("INSERT INTO enrollments(user_id,course_id,created_at) VALUES(?,?,?)").run(student.id,secondCourse.id,now());
    const before=(await getStudentGroupAccessStates(student.id)).find(group=>group.id===first)!;
    assert.ok(before.sources.includes("manual"));assert.ok(before.sources.includes("free_membership"));
    await configure([]);
    assert.ok(await getAccessibleGroup(student.id,first));assert.equal(await getAccessibleGroup(student.id,second),undefined);
    assert.equal(await hasCourseAccess(student.id,secondCourse.id),true);
    assert.deepEqual((await getStudentGroupAccessStates(student.id)).find(group=>group.id===first)?.sources,["manual"]);
    assert.equal((await getStudentFreeMembership(student.id)).isMember,true);
  });
  test(`${provider}: a Bas group is a valid source for diploma issuance and publication gates remain in force`,async()=>{
    const course=await courseFixture(),group=await groupFixture([course.id]);await configure([group]);
    const user=await createUser({name:"Bas diploma student",email:`diploma-${token()}@example.test`,role:"student",passwordHash:"fixture"});
    await getDb().prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now(),user.id);await joinFreeMembership(user.id);
    await getDb().prepare("INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(?,?,?)").run(user.id,course.lessonId,now());
    const settings=await getCourseCertificateSettings(course.id);await saveCourseCertificateSettings(admin.id,course.id,{enabled:true,expectedUpdatedAt:settings.updatedAt});
    const certificate=await issueCourseCertificate(user.id,course.id);assert.equal(certificate.userId,user.id);
    await getDb().prepare("UPDATE membership_groups SET published=0 WHERE id=?").run(group);
    assert.equal(await hasCourseAccess(user.id,course.id),false);assert.equal(await getAccessibleGroup(user.id,group),undefined);
    assert.deepEqual(await issueCourseCertificate(user.id,course.id),certificate);
    await configure([]);
  });
  test(`${provider}: deleting a student or linked group removes Bas relations including HTTP foreign-key fallback`,async()=>{
    const user=await createUser({name:"Privacy Bas student",email:`privacy-${token()}@example.test`,role:"student",passwordHash:"fixture"});
    await enrollNewStudentInFreeMembership(user.id);
    const group=await groupFixture();await configure([group]);
    if(provider==="sqlite")await getDb().exec("PRAGMA foreign_keys=OFF");
    await getDb().prepare("DELETE FROM users WHERE id=?").run(user.id);
    await getDb().prepare("DELETE FROM membership_groups WHERE id=?").run(group);
    if(provider==="sqlite")await getDb().exec("PRAGMA foreign_keys=ON");
    assert.equal(await getDb().prepare("SELECT user_id FROM free_membership_members WHERE user_id=?").get(user.id),undefined);
    assert.equal(await getDb().prepare("SELECT group_id FROM free_membership_groups WHERE group_id=?").get(group),undefined);
    assert.deepEqual((await getPublicFreeMembership()).groups,[]);
  });
}
