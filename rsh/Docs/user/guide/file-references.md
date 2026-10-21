# Reference local files without extra services

English | [中文](file-references.zh.md)

## Summary

Use the existing Web UI to select workspace files and check their paths before sending a task. This guide is a local Markdown file: reading it does not require a model, subscription, or network connection. It covers the Harness conversation composer; a separate IDE editor can have different controls.

## Table of Contents

- [Choose the workspace](#choose-the-workspace)
- [Select and inspect a file](#select-and-inspect-a-file)
- [Check results and failures](#check-results-and-failures)
- [Keep model costs separate](#keep-model-costs-separate)
- [Dev Note](#dev-note)

<a id="choose-the-workspace"></a>
## Choose the workspace

Start with an already running Web UI and follow [Choose a workspace](index.md). Select the directory containing the assignment or project. Check the session's workspace before adding references, especially when two projects contain files with the same name.

<a id="select-and-inspect-a-file"></a>
## Select and inspect a file

1. Type `@` in the conversation composer, then part of a file name or a relative path. File and session candidates share this menu; choose a file row for a file reference.
2. Select the desired file. A path such as `作业/实验报告.md` becomes `@作业/实验报告.md`; spaces require quotes, as in `@"课程 资料/实验 报告.md"`. Selecting a candidate handles the quoting.
3. To browse inside a folder, use its arrow or Tab. Selecting the folder row itself inserts a folder reference; it does not attach every file in that folder.
4. Click the inserted file reference to open its current contents in the right sidebar. Check the path and content before sending. A reference label alone does not prove that the model has read the file.

You can stop after selecting and previewing the file. Sending the task is a separate action that can invoke the configured model. A file reference identifies a path; it does not freeze a copy of the file's contents.

<a id="check-results-and-failures"></a>
## Check results and failures

After sending an authorized task, review its tool results and response in the same conversation. For a generated file, inspect the actual file in the workspace before relying on the response's description.

| Symptom | What to check |
|---|---|
| No file candidates | Confirm the workspace and try a relative directory path. An unavailable or failed discovery service can also produce an empty menu; this does not prove the file is absent. |
| A file is missing from search | Check its directory, spelling, and access rights. Discovery excludes configured directories and does not follow directory symlinks. |
| A preview or read fails | Check the reported path and error, then whether the file still exists and is readable. Do not substitute another same-named file. |
| Sending is rejected | Read the error near the composer and check the restored draft before retrying. Do not assume a rejected submission completed a model turn. |

<a id="keep-model-costs-separate"></a>
## Keep model costs separate

Reading this guide and browsing local file references do not themselves request model inference. Sending a task can send referenced content to the selected provider and consume its quota. Plugin availability does not establish that a model is free. Check the provider and account allowance before sending; without confirmed resources, stop at local selection and preview. See [model configuration](providers.md) for connection settings.

<a id="dev-note"></a>
## Dev Note

The focused tests cover local discovery, Chinese and spaced paths, reference selection, serialization, preview routing, and rejected submissions. Real desktop interaction and model responses require separate acceptance checks by the person integrating the running UI; these tests do not verify the separate IDE workbench.
