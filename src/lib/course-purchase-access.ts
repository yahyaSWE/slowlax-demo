/** A paid one-time purchase grants the course permanently, independently of its optional group. */
export function coursePurchaseAccessSql(userExpr = "u.id", courseExpr = "c.id"): string {
  return `EXISTS(SELECT 1 FROM course_purchases cp_access
    JOIN course_purchase_attempts cpa_access ON cpa_access.id=cp_access.attempt_id AND cpa_access.status='paid'
    JOIN courses cpc_access ON cpc_access.id=cp_access.course_id AND cpc_access.published=1
    JOIN users cpu_access ON cpu_access.id=cp_access.user_id AND cpu_access.role='student' AND cpu_access.email_verified_at IS NOT NULL
    WHERE cp_access.user_id=${userExpr} AND cp_access.course_id=${courseExpr}
      AND cp_access.revoked=0 AND julianday(cp_access.paid_at)<=julianday('now'))`;
}

/** Group access is source-specific and can expire while the purchased course remains accessible. */
export function coursePurchaseGroupAccessSql(userExpr = "u.id", groupExpr = "g.id"): string {
  return `EXISTS(SELECT 1 FROM course_purchases cpg_access
    JOIN course_purchase_attempts cpga_access ON cpga_access.id=cpg_access.attempt_id AND cpga_access.status='paid'
    JOIN membership_groups cpgg_access ON cpgg_access.id=cpg_access.group_id AND cpgg_access.published=1
    JOIN users cpgu_access ON cpgu_access.id=cpg_access.user_id AND cpgu_access.role='student' AND cpgu_access.email_verified_at IS NOT NULL
    WHERE cpg_access.user_id=${userExpr} AND cpg_access.group_id=${groupExpr}
      AND cpg_access.revoked=0 AND julianday(cpg_access.paid_at)<=julianday('now')
      AND (cpg_access.group_expires_at IS NULL OR julianday(cpg_access.group_expires_at)>julianday('now')))`;
}
