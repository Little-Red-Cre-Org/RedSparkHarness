"""Python twin of the native SDK recorded-session scenario through the public dsh profile."""
import json
import sys

from deepseek_harness import DeepSeekHarness, DeepSeekHarnessConfig
from deepseek_harness.errors import JsonRpcError

launcher, home, workspace, patch, task = sys.argv[1:]
config = DeepSeekHarnessConfig(dsh_bin=launcher, profile="native-sdk", dsh_home=home,
    patches=(patch,), cwd=workspace, provider="fixture", model="fixture-model",
    request_timeout_seconds=20, env={"NATIVE_SDK_FIXTURE_KEY": "fixture-key"})
with DeepSeekHarness(config) as harness:
    session = harness.start_session("sdk-recorded-turn")
    assert session.cancel() is False
    cancelled = False

    def observe(notification):
        global cancelled
        if notification.method == "session.chunk" and notification.payload["chunk"]["type"] == "text-delta" and not cancelled:
            cancelled = True
            assert harness.start_session("unknown-session").cancel() is False
            assert session.cancel() is True

    result = session.run(task, on_notification=observe)
    assert cancelled
    assert result.events[-1]["data"]["reason"] == {"kind": "aborted", "reason": {"kind": "user"}}
    assert any(event["type"] == "assistant/attempt" for event in result.events)
with DeepSeekHarness(config) as resumed:
    result = resumed.run("finish after cancellation", session_id="sdk-recorded-turn")
    source = resumed.start_session("sdk-recorded-turn")
    for destination, anchor in [("sdk-recorded-turn", None), ("sdk-recorded-fork", 9007199254740991)]:
        try:
            source.fork(destination, anchor)
        except JsonRpcError:
            pass
        else:
            raise AssertionError("invalid fork accepted")
    fork = source.fork("sdk-recorded-fork", result.events[-1]["seq"])
    assert fork.id == "sdk-recorded-fork"
with DeepSeekHarness(config) as forked:
    result = forked.start_session("sdk-recorded-fork").run("finish the cold fork")
print(json.dumps({"finalResponse": result.final_response, "events": result.events}))
