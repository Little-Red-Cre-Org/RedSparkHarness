"""Python SDK runner for the native Inbox Session owner."""

import json
import sys

from deepseek_harness import DeepSeekHarness, DeepSeekHarnessConfig

launcher, home, workspace, model_patch, session_id, task, recovery_task = sys.argv[1:]
config = DeepSeekHarnessConfig(
    dsh_bin=None if launcher == "-" else launcher,
    profile="native-sdk",
    patches=(model_patch,),
    dsh_home=home,
    cwd=workspace,
    provider="fixture",
    model="fixture-model",
    request_timeout_seconds=20,
    env={"NATIVE_INBOX_FIXTURE_KEY": "fixture-key", "DSH_TELEMETRY_DISABLED": "1"},
)


def serialize(result):
    return {
        "finalResponse": result.final_response,
        "events": result.events,
        "notifications": [{"method": item.method, "params": item.payload} for item in result.notifications],
    }


with DeepSeekHarness(config) as first:
    initial = serialize(first.start_session(session_id).run(task))

with DeepSeekHarness(config) as cold:
    restored = serialize(cold.start_session(session_id).run(recovery_task))

print(json.dumps({"first": initial, "recovery": restored}))
