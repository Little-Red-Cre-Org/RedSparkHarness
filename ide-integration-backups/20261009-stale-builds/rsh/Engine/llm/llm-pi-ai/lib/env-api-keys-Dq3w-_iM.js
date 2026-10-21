//#region ../../../../node_modules/.pnpm/@earendil-works+pi-ai@1.0.0_71d8dfff7c0445882abb8c414f4fc20f/node_modules/@earendil-works/pi-ai/dist/env-api-keys.js
var __rewriteRelativeImportExtension = function(path, preserveJsx) {
	if (typeof path === "string" && /^\.\.?\//.test(path)) return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
		return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
	});
	return path;
};
const dynamicImport = (specifier) => import(__rewriteRelativeImportExtension(specifier));
const NODE_FS_SPECIFIER = "node:fs";
const NODE_OS_SPECIFIER = "node:os";
const NODE_PATH_SPECIFIER = "node:path";
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
	dynamicImport(NODE_FS_SPECIFIER).then((m) => {
		m.existsSync;
	});
	dynamicImport(NODE_OS_SPECIFIER).then((m) => {
		m.homedir;
	});
	dynamicImport(NODE_PATH_SPECIFIER).then((m) => {
		m.join;
	});
}
const ANTHROPIC_AUTH_TOKEN_ENV = "ANTHROPIC_AUTH_TOKEN";
const ANTHROPIC_OAUTH_TOKEN_ENV = "ANTHROPIC_OAUTH_TOKEN";
const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";
const ANTHROPIC_FEDERATION_RULE_ID_ENV = "ANTHROPIC_FEDERATION_RULE_ID";
const ANTHROPIC_ORGANIZATION_ID_ENV = "ANTHROPIC_ORGANIZATION_ID";
const ANTHROPIC_SERVICE_ACCOUNT_ID_ENV = "ANTHROPIC_SERVICE_ACCOUNT_ID";
const ANTHROPIC_IDENTITY_TOKEN_FILE_ENV = "ANTHROPIC_IDENTITY_TOKEN_FILE";
const ANTHROPIC_WORKSPACE_ID_ENV = "ANTHROPIC_WORKSPACE_ID";
//#endregion
export { ANTHROPIC_OAUTH_TOKEN_ENV as a, ANTHROPIC_WORKSPACE_ID_ENV as c, ANTHROPIC_IDENTITY_TOKEN_FILE_ENV as i, ANTHROPIC_AUTH_TOKEN_ENV as n, ANTHROPIC_ORGANIZATION_ID_ENV as o, ANTHROPIC_FEDERATION_RULE_ID_ENV as r, ANTHROPIC_SERVICE_ACCOUNT_ID_ENV as s, ANTHROPIC_API_KEY_ENV as t };
