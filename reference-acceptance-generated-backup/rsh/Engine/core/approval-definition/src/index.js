/** Framework-free native approval identities and consumer operations. */
import { brandString } from '@deepseek-ai/dsh-brand';
import { SessionSeq } from '@deepseek-ai/dsh-session/native';
/** Read the latest durable approval override from the Session that owns an invocation.
 * @param session - the existing Session whose log is the policy authority.
 * @returns its latest compatibility approval override, or `undefined` when none was recorded.
 */
export function sessionApprovalPolicy(session) {
    for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
        // oxlint-disable-next-line typescript/no-deprecated -- Keep the pure durable fold until Session exposes its public event iterator.
        const event = session.eventAt(SessionSeq(seq));
        if (event?.type === 'approval/policy')
            return event.data.policy;
    }
    return undefined;
}
/**
 * Brand a nonempty native approval request identifier.
 * @param value - raw identifier received at an application or persistence boundary.
 * @returns the opaque native approval request identifier.
 */
export function NativeApprovalRequestId(value) {
    if (value.length === 0)
        throw new Error('native-approval: request id must be nonempty');
    return brandString(value);
}
//# sourceMappingURL=index.js.map