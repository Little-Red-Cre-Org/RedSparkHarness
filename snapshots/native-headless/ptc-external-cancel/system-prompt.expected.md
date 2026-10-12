Delegate nested work through run_code and stop cleanly when it is cancelled.

## Writing code for run_code

`run_code` takes two required strings: `code`, the body of an async TypeScript function (erasable syntax only), and `description`, a concise active-voice summary of what the program does. Top-level `await` and `return` work. Call the declared bindings as `await tools.name(args)` with lossless JSON arguments. Each call returns its canonical JSON value; failure rejects with `ToolCallError` and `toolName`. Independent safe calls may overlap with `Promise.all`; sequence dependent calls with `await`. Use `return` and `console.log` for output. The model sees captured logs and completion text, or a program failure. Successful nested images and sourced extra contexts are attached after the outer result. Other intermediate presentations stay out of the conversation. Only separately supplied tool schemas are directly callable.

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

interface ToolArgsMap {
  /** Delegate one task to a fresh child without your conversation. This call waits for its final result and cleanup. */
  subagent: {
    description: string;
    prompt: string;
  };
}

interface ToolOutputMap {
  subagent: {
    id: string;
    provider: string;
    stopReason: "completed" | "max-tokens" | "aborted" | "refusal" | "error";
    output: Record<string, JsonValue>[];
  } | {
    id: string;
    jobId: string;
    provider: string;
  } | {
    id: string;
    provider: string;
    remoteId: string;
    stopReason: "completed" | "max-tokens" | "aborted" | "refusal" | "error";
    output: Record<string, JsonValue>[];
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
