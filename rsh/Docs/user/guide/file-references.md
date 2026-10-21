# Reference local files and conversations

English | [中文](file-references.zh.md)

This guide starts with an open RSH conversation and a selected project workspace. It covers the existing `@` menu in the Web UI and the conversation embedded in the IDE. You can read this Markdown file locally without a model or internet connection. Selecting references and previewing local text do not require a model request.

## 1. Check the workspace

Check the workspace name above the conversation input before choosing a file. Relative references belong to that conversation's working directory. Two projects can contain files with the same name; preview the selected file to check its contents before sending it.

## 2. Choose a file or folder

Type `@` in the conversation input. The menu groups **Files & folders** before **Sessions**. Type part of a filename or a directory path to narrow the candidates, then select a row. The selected reference appears as a compact label in the draft.

For a path containing spaces, select the menu item or enter a quoted reference such as `@"course work/中文 作业.txt"`. Keep the closing quote when entering a complete path manually. Copying a reference preserves its path representation; the visible filename alone does not identify its directory.

Selecting a folder row inserts the folder itself. Use Tab or the row's browse button to descend into it and choose a child. A folder reference does not attach every file in that folder.

If a newly created file does not appear in a fuzzy search, enter its directory path, for example `@src/` or `@"course work/` for a name containing spaces. Direct directory queries inspect that directory; fuzzy results use an index and may lag behind external file changes. See the [local discovery limits](../../../Engine/context/file-reference-local/README.md#known-limitations-and-deferred-work).

## 3. Preview before sending

Click a file reference in the draft to open its preview. Check the filename and text against the intended file. **Reload file** reads its current contents again. A file removed after selection produces a read error when reloaded; selecting it earlier does not preserve a private copy of its contents.

Selection and preview do not mean the model has read the file. File references are paths in the outgoing message; the agent must use a file tool to read the content. See [file reference behavior](../../../Engine/context/file-reference/README.md).

## 4. Reference another conversation

Type `@` and select an item from **Sessions**. Check its label and workspace information before sending. The reference retains the conversation's identity even when another conversation has the same title. A quoted `@"` search lists files only.

When the message is processed, the host validates the conversation reference and captures a bounded, read-only context snapshot. Later changes to the source do not rewrite that captured context. Reference preparation can fail, and a bounded snapshot is not a promise to include the entire history. See [conversation reference behavior](../../../Engine/context/session-reference/README.md).

## 5. Check the result and cost

Before sending, check the selected model and its provider's billing terms in [model settings](providers.md). Reading this local guide, selecting references, and previewing local files do not buy a subscription or invoke a model. Sending a message can incur model charges, including for referenced context and subsequent tool-result processing. A free editor or extension does not provide free model usage.

After sending, inspect the file-read result and the assistant's response in the same conversation. A reference label alone is not evidence of a successful read. If no verified free quota or local model is available, stop after selection and preview; model responses remain unverified.

## Troubleshooting

| What you see | What to check |
|---|---|
| No matching file | Check the conversation's workspace, spelling, and directory path. Candidate discovery is bounded and excludes configured directories. |
| Files or sessions are missing from the menu | One candidate source can fail while the other remains usable. An absent group alone does not prove that no files or conversations exist. |
| A preview reports a read error | Check whether the file still exists and is readable, then reload. Do not treat a previously displayed preview as current file content. |
| The model does not answer | Inspect the conversation's error and model configuration. Local selection or preview success does not validate credentials, quota, or provider availability. |

Continue with the [Web UI guide](index.md) or the [IDE usage instructions](../../../Programs/Desktop/README.md).
