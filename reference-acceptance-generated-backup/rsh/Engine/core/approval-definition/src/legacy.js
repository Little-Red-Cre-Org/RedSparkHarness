import { sessionApprovalPolicy } from "./index.js";
/** Every supported compatibility approval policy. */
export const APPROVAL_POLICIES = ['ask', 'never'];
/**
 * Brand a string as an {@link ApprovalRequestId}.
 * @param id - the raw id string to brand.
 * @returns the same string carrying the brand.
 */
export function ApprovalRequestId(id) {
    return id;
}
/**
 * Append the durable compatibility policy override.
 * @param session - the Session whose effective policy changes.
 * @param policy - the next explicit policy.
 */
export function setApprovalPolicy(session, policy) {
    if (!APPROVAL_POLICIES.includes(policy)) {
        throw new TypeError('approval policy must be one of "ask" or "never"');
    }
    session.append('approval/policy', { policy });
}
/**
 * Read the last compatibility policy override without applying a deployment default.
 * @param session - the exact Session whose log supplies the override.
 * @returns the last policy event, or `undefined` when the log has none.
 */
export function approvalPolicyOf(session) {
    return sessionApprovalPolicy(session);
}
//# sourceMappingURL=legacy.js.map