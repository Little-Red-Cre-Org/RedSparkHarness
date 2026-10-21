# Read an authorized Chrome page

English | [中文](browser-read-only.zh.md)

## Summary

This guide connects Windows Chrome to an already built Native Harness installation. You choose each page in the extension, then approve its read in the conversation. The local connection needs no paid service; sending a task still uses the configured model. Keep this Markdown file locally for offline setup.

For an explicitly configured Native Desktop profile, install the browser module in that Host profile, then open a settled Session with **Open in IDE**. The embedded conversation shares that Host's browser grants, approvals and persisted results. Adding the module to the separate `native-ide` editor profile does not add conversation tools. This does not convert or update an existing standard Desktop profile automatically.

## Table of Contents

- [Prepare the Native profile](#prepare-the-native-profile)
- [Install the Chrome connection](#install-the-chrome-connection)
- [Read and revoke](#read-and-revoke)
- [Troubleshooting](#troubleshooting)
- [Dev Note](#dev-note)

## Prepare the Native profile

Use a built checkout with Node.js and pnpm available. Start `pnpm dsh --profile native-web` once to create the profile, then stop that instance. Use an isolated `DSH_HOME` for evaluation. Its `profiles/native-web` directory must contain `rsh.profile.json` and a Native profile manifest. Do not add the installation to `cordis.yml` or to the separate `native-ide` editor profile.

From the checkout, build this optional package if its `lib/native.js` is absent:

```powershell
pnpm exec tsc -b rsh/Modules/Official/web/browser-read-only
pnpm --dir rsh/Modules/Official/web/browser-read-only exec tsdown
```

In the Native profile's directory, run `pnpm add "link:E:/your-checkout/rsh/Modules/Official/web/browser-read-only"`, replacing the checkout path. Add the following row to `installations` in `rsh.profile.json`; replace the user path with your own private local application-data directory. Keep the existing tools, approval service and conversation answerer.

```json
{
  "id": "browser-read-only",
  "plugin": "@deepseek-ai/dsh-browser-read-only",
  "scope": "root",
  "config": {
    "connectionFile": "C:/Users/you/AppData/Local/RedSparkHarness/browser-read-only/connection.json"
  }
}
```

Restart the same Native profile. The connection file contains a local authentication secret; do not copy it into a repository, shared directory, prompt or screenshot. Each simultaneously running Host needs its own file; Chrome registration selects one Host. Additional limits are listed in the [package reference](../../../Modules/Official/web/browser-read-only/README.md).

## Install the Chrome connection

From the same checkout, register the current user's Native Messaging helper with the identical connection-file path:

```powershell
$connectionFile = Join-Path $env:LOCALAPPDATA 'RedSparkHarness/browser-read-only/connection.json'
& ./rsh/Modules/Official/web/browser-read-only/scripts/register-chrome.ps1 -ConnectionFile $connectionFile
```

Open `chrome://extensions`, enable Developer mode and choose **Load unpacked**. Select the package's `extension` directory printed by the script. The extension is named **RedSpark Harness Read Only**. Pin it for convenient access. Registration does not install the extension automatically and does not change the default Harness profile.

## Read and revoke

1. Open a normal HTTP or HTTPS page. Click the extension icon or press **Alt+Shift+R**.
2. Click **Connect**, then **Authorize current page**. Check the listed title and URL. Only authorized pages appear in Harness; other tabs are not listed.
3. In the running Native conversation, ask: “Read the authorized browser page and cite its source URL.” Approve the browser read when Harness asks. The tool result contains the title, URL, text and truncation flag, and is saved in that Session.
4. Click **Revoke** beside a page to stop future reads, or **Disconnect** to remove all grants. Navigation, reload, closing the tab and disconnect also invalidate grants. Reconnect and authorize again when needed.

Grants apply to the connected Host; each consuming conversation uses its existing approval flow. Revocation does not erase content already logged or sent to a model. The extension excludes form values and cookies, but visible page text can still contain private information. It reads top-document text only; it cannot operate the page or read PDF, image, iframe or shadow-root content. See [scope and limits](../../../Modules/Official/web/browser-read-only/README.md#known-limitations-and-deferred-work).

## Troubleshooting

| Symptom | Action |
|---|---|
| Cannot connect | Check the Native profile is running, the registration uses its connection file, and Node.js and the built helper have not moved. Reconnect manually. |
| Page cannot be authorized | Open an ordinary HTTP(S) page, then open the extension from that tab. Chrome internal pages, extension pages and file URLs are unsupported. |
| Missing approval authority or denied read | Use the Native conversation profile with its existing approval service and answerer; approve the specific read. Browser authorization does not bypass Harness approval. |
| Page changed or read timed out | Check the source tab, reopen the extension and authorize it again. There is no automatic retry. |
| Existing connection file blocks startup | Confirm the owning Host is stopped before removing its stale discovery file. Never remove a live Host's file. |

To disconnect permanently, remove the browser installation row and local package link from the stopped profile, remove the Chrome extension, then rerun the registration command with `-Unregister`. This unregisters only that installation's current-user Chrome host. It retains files, browser data and all Sessions.

## Dev Note

The connection script registers a private stdio relay; application startup still uses `dsh --profile`. Local acceptance uses no model API credentials. Model-provider quality, costs and behavior require separate validation with the selected account.
