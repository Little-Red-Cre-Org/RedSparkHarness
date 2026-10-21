//#region ../../../Core/util/brand/src/index.ts
/**
* Apply a compile-time string brand without changing the value.
* @param value - string admitted by the domain that owns the target brand.
* @returns the same string with the requested compile-time brand.
*/
function brandString(value) {
	return value;
}
/**
* Apply a compile-time number brand without changing the value.
* @param value - number admitted by the domain that owns the target brand.
* @returns the same number with the requested compile-time brand.
*/
function brandNumber(value) {
	return value;
}
//#endregion
//#region ../../core/session/src/types.ts
/**
* Admit a numeric value as an existing Session event position.
* @param value - non-negative safe integer admitted by the owning log operation.
* @returns the same number with the Session-sequence brand.
*/
function SessionSeq(value) {
	if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError(`SessionSeq must be a non-negative safe integer, got ${String(value)}`);
	return brandNumber(value);
}
/**
* Admit a numeric value as a Session log offset.
* @param value - non-negative safe integer used as a gap or prefix length.
* @returns the same number with the Session-log-offset brand.
*/
function SessionLogOffset(value) {
	if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError(`SessionLogOffset must be a non-negative safe integer, got ${String(value)}`);
	return brandNumber(value);
}
//#endregion
export { SessionSeq as n, brandString as r, SessionLogOffset as t };
