Use run_code to inspect and cancel the background job.

Call tools only through `run_code`; business names below are program bindings.

## Writing code for run_code

`run_code` takes two required strings: `code`, the body of an async TypeScript function (erasable syntax only), and `description`, a concise active-voice summary of what the program does. Top-level `await` and `return` work. Call the declared bindings as `await tools.name(args)` with lossless JSON arguments. Each call returns its canonical JSON value; failure rejects with `ToolCallError` and `toolName`. Independent safe calls may overlap with `Promise.all`; sequence dependent calls with `await`. Use `return` and `console.log` for output. The model sees captured logs and completion text, or a program failure. Successful nested images and sourced extra contexts are attached after the outer result. Other intermediate presentations stay out of the conversation. Only separately supplied tool schemas are directly callable.

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

interface ToolArgsMap {
  /** Request cancellation of one background job owned by this Agent. */
  job_kill: {
    job_id: string;
    reason?: string;
  };
  /** List background jobs owned by this Agent. */
  job_list: Record<string, never>;
  /** Read a background job result and status; optionally wait for completion. */
  job_output: {
    job_id: string;
    wait?: boolean;
    timeout_ms?: number;
  };
}

interface ToolOutputMap {
  job_kill: {
    text: string;
    jobs: ({
      id: string;
      kind: string;
      label: string;
      status: "running" | "stopping" | "completed" | "failed" | "cancelled";
      startedAt: number;
      finishedAt?: number;
      detail?: string;
    })[];
    outcome?: "requested" | "already-finished";
  };
  job_list: {
    text: string;
    jobs: ({
      id: string;
      kind: string;
      label: string;
      status: "running" | "stopping" | "completed" | "failed" | "cancelled";
      startedAt: number;
      finishedAt?: number;
      detail?: string;
    })[];
    outcome?: "requested" | "already-finished";
  };
  job_output: {
    text: string;
    jobs: ({
      id: string;
      kind: string;
      label: string;
      status: "running" | "stopping" | "completed" | "failed" | "cancelled";
      startedAt: number;
      finishedAt?: number;
      detail?: string;
    })[];
    outcome?: "requested" | "already-finished";
  };
}

type ToolName = keyof ToolOutputMap

declare class ToolCallError extends Error {
  readonly name: "ToolCallError";
  readonly toolName: ToolName;
}

declare const tools: {
  [K in ToolName]: (args: ToolArgsMap[K]) => Promise<ToolOutputMap[K]>;
}
```
