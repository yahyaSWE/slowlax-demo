import { coursePurchaseGroupAccessSql } from "./course-purchase-access";

/** A membership grant is independent of a lifetime enrollment and of sales status. */
export function membershipGroupAccessSql(userExpr = "u.id", groupExpr = "g.id"): string {
  return `EXISTS(SELECT 1 FROM membership_groups mg_access
    WHERE mg_access.id=${groupExpr} AND mg_access.published=1
    AND EXISTS(SELECT 1 FROM users mu_access WHERE mu_access.id=${userExpr} AND mu_access.role='student' AND mu_access.email_verified_at IS NOT NULL)
    AND (
      EXISTS(SELECT 1 FROM free_membership_members fm_access
        JOIN free_membership_groups fg_access ON fg_access.group_id=mg_access.id
        WHERE fm_access.user_id=${userExpr})
      OR
      EXISTS(SELECT 1 FROM membership_assignments ma_access
        WHERE ma_access.group_id=mg_access.id AND ma_access.user_id=${userExpr}
        AND (ma_access.expires_at IS NULL OR julianday(ma_access.expires_at)>julianday('now')))
      OR EXISTS(SELECT 1 FROM membership_subscriptions ms_access
        WHERE (EXISTS(SELECT 1 FROM membership_attempt_groups mag_access WHERE mag_access.attempt_id=ms_access.attempt_id AND mag_access.group_id=mg_access.id)
          OR (ms_access.group_id=mg_access.id AND NOT EXISTS(SELECT 1 FROM membership_attempt_groups mag_legacy WHERE mag_legacy.attempt_id=ms_access.attempt_id))) AND ms_access.user_id=${userExpr}
        AND ms_access.status IN ('active','past_due') AND ms_access.blocked=0
        AND julianday(ms_access.paid_until)>julianday('now'))
      OR ${coursePurchaseGroupAccessSql(userExpr, "mg_access.id")}
    ))`;
}

/** Callers still enforce course publication, role and the enrollment alternative. */
export function membershipCourseAccessSql(userExpr = "u.id", courseExpr = "c.id"): string {
  return `EXISTS(SELECT 1 FROM membership_group_courses mgc_access
    WHERE mgc_access.course_id=${courseExpr}
    AND ${membershipGroupAccessSql(userExpr, "mgc_access.group_id")})`;
}
