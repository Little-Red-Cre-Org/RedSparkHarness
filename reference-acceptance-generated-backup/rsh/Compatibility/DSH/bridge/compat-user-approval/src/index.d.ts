/**
 * Service Definition for the approval capability seam, covering requests, cancellation, audit, and per-session policy. Missing
 * answerers fail closed; grants apply only to the requested action.
 * @module @deepseek-ai/dsh-user-approval
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session/native';
import type { ApprovalOutcome, ApprovalPolicy } from '@deepseek-ai/dsh-approval-definition/legacy';
import type { ApprovalRequest, ApprovalServiceDefinition } from './types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        approval: ApprovalServiceDefinition;
    }
}
export { APPROVAL_POLICIES, ApprovalRequestId, setApprovalPolicy } from '@deepseek-ai/dsh-approval-definition/legacy';
export type { ApprovalOutcome, ApprovalPolicy, ApprovalRequest, ApprovalRequestEvent, ApprovalServiceDefinition, } from './types.ts';
/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
    /**
     * The deployment's default {@link ApprovalPolicy} for sessions without an
     * `approval/policy` override — `'ask'` delegates to the composed answerers
     * (fail-closed with none); `'never'` auto-rejects every ask without
     * prompting (the deterministic CI/unattended stance).
     */
    readonly policy?: ApprovalPolicy;
}
/**
 * Approval service that applies session policy before answerers and logs every
 * ask/outcome pair to the requesting session. It exposes deterministic policy
 * changes to the model through the runtime-context snapshot and switch notices.
 */
export declare class ApprovalService extends Service implements ApprovalServiceDefinition {
    config: Config;
    static Config: z<Config>;
    constructor(ctx: Context, config: Config);
    /**
     * Switch one live agent's policy and queue the transition for its next model
     * step. Session initialization uses {@link setApprovalPolicy} directly
     * because there is no previously visible policy to change.
     * @param agent - the live agent whose policy is changing.
     * @param policy - the new effective policy.
     */
    setPolicy(agent: Agent, policy: ApprovalPolicy): void;
    /**
     * Record the audit pair around the composed answerer decision.
     * @param req - the pending decision (agent, tool identity, reason, signal).
     * @returns the closed outcome; `'allowed-once'` is the only grant.
     */
    request(req: ApprovalRequest): Promise<ApprovalOutcome>;
    /**
     * The session's effective policy: its own `approval/policy` fold, else the
     * configured default (the schema already defaulted an omitted policy to
     * `'ask'`; the `??` only narrows the optional-input TYPE).
     * @param session - the exact accepted session whose policy applies.
     * @returns the policy every ask for this session resolves under right now.
     */
    private effectivePolicy;
    /**
     * Read the session override without applying the configured default.
     * @param session - session whose log supplies the override.
     * @returns the last logged policy, or `undefined` without one.
     */
    overrideOf(session: Session): ApprovalPolicy | undefined;
    /**
     * Dispatch the waterfall, contained and raced against the request signal.
     * @param req - the borrowed public request.
     * @param session - the request agent's session used for policy lookup.
     * @returns the normalized closed outcome.
     */
    private decide;
}
export default ApprovalService;
//# sourceMappingURL=index.d.ts.map