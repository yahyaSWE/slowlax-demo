/** A membership grant is independent of a lifetime enrollment and of sales status. */
export function membershipGroupAccessSql(userExpr = "u.id", groupExpr = "g.id"): string {
  return `EXISTS(SELECT 1 FROM membership_groups mg_access
    WHERE mg_access.id=${groupExpr} AND mg_access.published=1
    AND EXISTS(SELECT 1 FROM users mu_access WHERE mu_access.id=${userExpr} AND mu_access.role='student' AND mu_access.email_verified_at IS NOT NULL)
    AND (
      EXISTS(SELECT 1 FROM membership_assignments ma_access
        WHERE ma_access.group_id=mg_access.id AND ma_access.user_id=${userExpr}
        AND (ma_access.expires_at IS NULL OR julianday(ma_access.expires_at)>julianday('now')))
      OR EXISTS(SELECT 1 FROM membership_subscriptions ms_access
        WHERE ms_access.group_id=mg_access.id AND ms_access.user_id=${userExpr}
        AND ms_access.status IN ('active','past_due') AND ms_access.blocked=0
        AND julianday(ms_access.paid_until)>julianday('now'))
    ))`;
}

/** Callers still enforce course publication, role and the enrollment alternative. */
export function membershipCourseAccessSql(userExpr = "u.id", courseExpr = "c.id"): string {
  return `EXISTS(SELECT 1 FROM membership_group_courses mgc_access
    WHERE mgc_access.course_id=${courseExpr}
    AND ${membershipGroupAccessSql(userExpr, "mgc_access.group_id")})`;
}
