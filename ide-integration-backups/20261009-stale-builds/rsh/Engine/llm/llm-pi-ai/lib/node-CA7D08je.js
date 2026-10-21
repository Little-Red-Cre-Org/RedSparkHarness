import { r as __exportAll } from "./rolldown-runtime-CNf5ZN-e.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as child_process from "node:child_process";
import * as crypto from "node:crypto";
import * as stream from "node:stream";
import * as util from "node:util";
//#region ../../../../node_modules/.pnpm/@anthropic-ai+sdk@0.124.0_zod@4.4.3/node_modules/@anthropic-ai/sdk/internal/node.mjs
/**
* The one module under `src/` that may import Node built-ins (eslint enforces this).
* The package.json `browser` field swaps it for `./node.browser`, so only touch its
* exports on code paths that run on Node-compatible runtimes.
*/
var node_exports = /* @__PURE__ */ __exportAll({
	child_process: () => child_process,
	crypto: () => crypto,
	fs: () => fs,
	path: () => path,
	stream: () => stream,
	util: () => util
});
//#endregion
export { path as a, node_exports as i, crypto as n, stream as o, fs as r, util as s, child_process as t };
