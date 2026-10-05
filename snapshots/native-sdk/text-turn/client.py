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
    result = restored.start_session("sdk-recorded-fork").run("delegate a native child")
    delegated = result
    result = restored.start_session("sdk-recorded-fork").run("spawn a production child")
    result.notifications[:0] = delegated.notifications
    started = [item.payload for item in result.notifications if item.method == "subagent.started"]
    assert len(started) == 2 and started[0] == {"parentSessionId": "sdk-recorded-fork", "childSessionId": "sdk-recorded-child"}
    assert started[1]["parentSessionId"] == "sdk-recorded-fork" and isinstance(started[1]["childSessionId"], str)
    assert any(item.method == "session.event" and item.payload["sessionId"] == "sdk-recorded-child"
        and item.payload["event"]["type"] == "turn/end" for item in result.notifications)
    assert not any(isinstance(value, str) and value.startswith("sdk-foreign-")
        for item in result.notifications for value in item.payload.values())
    production = result
    session = restored.start_session("sdk-recorded-fork")
    failed = session.run("fail a production child")
    tool_result = next(event for event in failed.events if event["type"] == "tool/result")
    assert tool_result["data"]["message"]["content"][0]["isError"] is True
    assert tool_result["data"]["message"]["content"][0]["content"] == [
        {"type": "text", "text": "Subagent ended: error. Partial output follows."},
        {"type": "text", "text": "partial failed child output"}]
    assert failed.final_response == result.final_response
    with restored.client.subscribe_session_notifications(session.id) as background_events:
        started = session.run("start a background child")
        assert started.events[-1]["data"]["reason"]["kind"] == "completed"
        start = next(event for event in started.events if event["type"] == "tool/result")["data"]["message"]["content"][0]
        assert start["isError"] is False and "Job: subagent-1" in start["content"][0]["text"]
        while True:
            notification = background_events.next()
            if notification.method == "session.event" and notification.payload["sessionId"] != session.id \
                and notification.payload["event"]["type"] == "tool/call":
                break
        stopped = session.run("stop the background child")
        outputs = [event["data"]["message"]["content"][0] for event in stopped.events if event["type"] == "tool/result"]
        assert "background child live output" in outputs[0]["content"][0]["text"]
        assert "running" in outputs[0]["content"][0]["text"]
        assert "requested cancellation" in outputs[1]["content"][0]["text"]
        assert "cancelled" in outputs[2]["content"][0]["text"]
        assert stopped.final_response == result.final_response
    child_cancelled = False

    def cancel_child(notification):
        global child_cancelled
        if notification.method == "session.event" and notification.payload["sessionId"] != session.id \
            and notification.payload["event"]["type"] == "tool/call" and not child_cancelled:
            child_cancelled = True
            assert session.cancel() is True

    cancelled_child = session.run("cancel a production child", on_notification=cancel_child)
    assert child_cancelled
    assert cancelled_child.events[-1]["data"]["reason"]["kind"] == "aborted"
    assert any(item.method == "session.event" and item.payload["sessionId"] != session.id
        and item.payload["event"]["type"] == "turn/end" for item in cancelled_child.notifications)
    result = production
with DeepSeekHarness(config) as recovered:
    resumed = recovered.start_session("sdk-recorded-fork").run("recover after child cancellation")
    assert resumed.events[-1]["data"]["reason"]["kind"] == "completed"
    assert resumed.final_response == result.final_response
    session = recovered.start_session("sdk-recorded-fork")
    with recovered.client.subscribe_session_notifications(session.id) as tree:
        started = session.run("start a continuable child")
        start = next(event for event in started.events if event["type"] == "tool/result")["data"]["message"]["content"][0]
        assert start["isError"] is False
        continuation_id = start["content"][0]["text"].removeprefix("started subagent ")
        while True:
            notification = tree.next()
            if notification.method == "session.event" and notification.payload["sessionId"] == continuation_id \
                and notification.payload["event"]["type"] == "tool/call":
                break
        controlled = session.run("message and interrupt the continuable child")
        assert all(event["data"]["message"]["content"][0]["isError"] is False
            for event in controlled.events if event["type"] == "tool/result")
        while True:
            notification = tree.next()
            if notification.method == "session.event" and notification.payload["sessionId"] == continuation_id \
                and notification.payload["event"]["type"] == "turn/end":
                assert notification.payload["event"]["data"]["reason"]["kind"] == "aborted"
                break
with DeepSeekHarness(config) as cold:
    session = cold.start_session("sdk-recorded-fork")
    with cold.client.subscribe_session_notifications(session.id) as tree:
        refused = session.run("refuse invalid continuation recipients")
        refused_results = [event for event in refused.events if event["type"] == "tool/result"]
        assert len(refused_results) == 2 and all(event["data"]["message"]["content"][0]["isError"] is True for event in refused_results)
        sent = session.run("cold resume the continuable child")
        assert next(event for event in sent.events if event["type"] == "tool/result")["data"]["message"]["content"][0]["isError"] is False
        while True:
            notification = tree.next()
            if notification.method == "session.event" and notification.payload["sessionId"] == continuation_id \
                and notification.payload["event"]["type"] == "turn/end":
                assert notification.payload["event"]["data"]["reason"]["kind"] == "completed"
                break
print(json.dumps({"finalResponse": result.final_response, "events": result.events,
    "notifications": [{"method": item.method, "params": item.payload} for item in result.notifications]}))
