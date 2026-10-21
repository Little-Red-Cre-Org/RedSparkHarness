/** Recoverable deletion capability owned by the selected durable storage Provider. */
import { brandString } from '@deepseek-ai/dsh-brand';
/** Validate a deletion receipt from wire or disk before resolving storage paths.
 * @param value - untrusted receipt identity.
 * @returns validated opaque identity.
 */
export function SessionDeletionId(value) {
    if (!/^[a-f0-9]{32}$/.test(value))
        throw new TypeError('invalid Session deletion identity');
    return brandString(value);
}
//# sourceMappingURL=deletion.js.map