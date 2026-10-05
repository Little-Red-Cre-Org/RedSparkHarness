"""Python twin of the native SDK recorded-session scenario through the public dsh profile."""
import base64
from pathlib import Path
import json
import sys

from deepseek_harness import DeepSeekHarness, DeepSeekHarnessConfig
from deepseek_harness.errors import JsonRpcError

launcher, home, workspace, patch, task = sys.argv[1:]
config = DeepSeekHarnessConfig(dsh_bin=launcher, profile="native-sdk", dsh_home=home,
    patches=(patch,), cwd=workspace, provider="fixture", model="fixture-model",
    request_timeout_seconds=20, env={"NATIVE_SDK_FIXTURE_KEY": "fixture-key"})
def refuse_steering(session, text):
    try:
        session.steer(text)
    except JsonRpcError:
        return
    raise AssertionError("inactive steering accepted")


with DeepSeekHarness(config) as harness:
    session = harness.start_session("sdk-recorded-turn")
    assert session.cancel() is False
    refuse_steering(session, "idle steering")
    cancelled = False
    steering = None

    def observe(notification):
        global cancelled, steering
        if notification.method == "session.chunk" and notification.payload["chunk"]["type"] == "text-delta" and not cancelled:
            cancelled = True
            assert harness.start_session("unknown-session").cancel() is False
            refuse_steering(harness.start_session("unknown-session"), "foreign steering")
            steering = session.steer("redirect after cancellation")
            assert steering
            assert session.cancel() is True

    result = session.run(task, on_notification=observe)
    assert cancelled
    assert result.events[-1]["data"]["reason"] == {"kind": "aborted", "reason": {"kind": "user"}}
    assert any(event["type"] == "assistant/attempt" for event in result.events)
    assert any(event["type"] == "agent/inbox/spliced" and event["data"]["target"] == "next-step"
        and any(message["id"] == steering for message in event["data"]["inserted"]) for event in result.events)
    refuse_steering(session, "settled steering")
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
    session = forked.start_session("sdk-recorded-fork")
    data = base64.b64encode(Path(__file__).with_name("image.png").read_bytes()).decode("ascii")
    for encoded, mime in [("invalid", "image/png"), (data, "image/jpeg")]:
        try:
            session.run([{"type": "image", "data": encoded, "mimeType": mime}])
        except JsonRpcError:
            pass
        else:
            raise AssertionError("invalid image accepted")
    result = session.run([{"type": "text", "text": "finish the cold fork"},
        {"type": "image", "data": data, "mimeType": "image/png"}])
with DeepSeekHarness(config) as restored:
    result = restored.start_session("sdk-recorded-fork").run("retain the image")
print(json.dumps({"finalResponse": result.final_response, "events": result.events}))
