"""Python SDK projection for the Native Skills recorded-session scenario."""
import json
import sys

from deepseek_harness import DeepSeekHarness, DeepSeekHarnessConfig

launcher, home, workspace, patch, session_id, task, recovery_task = sys.argv[1:]
config = DeepSeekHarnessConfig(dsh_bin=launcher, profile="native-sdk", dsh_home=home,
    patches=(patch,), cwd=workspace, provider="fixture", model="fixture-model",
    request_timeout_seconds=20, env={"NATIVE_SDK_FIXTURE_KEY": "fixture-key", "DSH_TELEMETRY_DISABLED": "1"})


def serialize(result):
    return {"finalResponse": result.final_response, "events": result.events,
        "notifications": [{"method": item.method, "params": item.payload} for item in result.notifications]}


with DeepSeekHarness(config) as initial:
    first = serialize(initial.start_session(session_id).run(task))

with DeepSeekHarness(config) as cold:
    recovery = serialize(cold.start_session(session_id).run(recovery_task))

print(json.dumps({"first": first, "recovery": recovery}))
