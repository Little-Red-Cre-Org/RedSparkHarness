"""Python twin of the native SDK recorded-session scenario through the public dsh profile."""
import base64
import os
from pathlib import Path
import json
import sys
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from urllib.request import Request, urlopen

from deepseek_harness import DeepSeekHarness, DeepSeekHarnessConfig
from deepseek_harness.errors import JsonRpcError, TransportClosedError

launcher, home, workspace, patch, *arguments = sys.argv[1:]
goal_control = arguments[-1:] == ["goal-control"]
scheduled_origin = arguments[-1:] == ["scheduled-origin"]
task = arguments[0] if arguments else "say hello through native SDK"
config = DeepSeekHarnessConfig(dsh_bin=launcher, profile="native-sdk", dsh_home=home,
    patches=(patch,), cwd=workspace, provider="fixture", model="fixture-model",
    request_timeout_seconds=20, env={"NATIVE_SDK_FIXTURE_KEY": "fixture-key"})
def refuse_steering(session, text):
    try:
        session.steer(text)
    except JsonRpcError:
        return
    raise AssertionError("inactive steering accepted")


class CleanupFailed(RuntimeError):
    def __init__(self, primary, failures):
        details = "; ".join(repr(failure) for failure in failures)
        super().__init__(f"native SDK Goal Python cleanup failed: {details}")
        self.primary_error = primary
        self.cleanup_errors = tuple(failures)


def expect_finished(notifications, child_id, stop_reason):
    ended = next((index for index, item in enumerate(notifications)
        if item.method == "session.event" and item.payload["sessionId"] == child_id
        and item.payload["event"]["type"] == "turn/end"), None)
    matches = [(index, item) for index, item in enumerate(notifications)
        if item.method == "subagent.finished" and item.payload["childSessionId"] == child_id]
    assert ended is not None and len(matches) == 1
    index, finished = matches[0]
    assert index > ended
    assert all(finished.payload.get(key) == value for key, value in {
        "provider": "spawn", "agentId": child_id, "childSessionId": child_id,
        "parentSessionId": "sdk-recorded-fork", "status": "ok" if stop_reason == "completed" else "error",
        "stopReason": stop_reason}.items())


def serialized(result):
    return {"finalResponse": result.final_response, "events": result.events,
        "notifications": [{"method": item.method, "params": item.payload} for item in result.notifications]}


if scheduled_origin:
    control_url = os.environ["NATIVE_SDK_SCHEDULED_ORIGIN_CONTROL_URL"]
    session_id = "sdk-scheduled-root-origin"

    def endpoint(path, expected=None):
        request = Request(f"{control_url}/{path}", data=b"" if path == "start-origin" else None,
            headers={"content-type": "application/json"} if path == "start-origin" else {},
            method="POST" if path == "start-origin" else "GET")
        with urlopen(request, timeout=15) as response:
            actual = response.read().decode()
        if expected is not None and actual != expected:
            raise AssertionError(f"expected {expected!r}, received {actual!r}")

    uninitialized = DeepSeekHarness(config)
    try:
        uninitialized.client.start()
        endpoint("await-origin-plugin-loaded", "ready")
        endpoint("start-origin", "accepted")
        endpoint("await-origin-root-waiting", "waiting")
    finally:
        uninitialized.close()
    endpoint("await-origin-root-rejected", "rejected")

    with DeepSeekHarness(config) as initializing:
        initializing.start()
        endpoint("start-origin", "accepted")
        endpoint("await-origin-ready", "ready")
    with DeepSeekHarness(config) as restored:
        result = restored.start_session(session_id).run(task)
        print(json.dumps({"run": serialized(result)}))
    raise SystemExit(0)


def _wait_for_goal_input(subscription, session_id):
    while True:
        notification = subscription.next()
        if notification.method != "session.event" or notification.payload.get("sessionId") != session_id:
            continue
        event = notification.payload.get("event", {})
        source = event.get("data", {}).get("source", {})
        if event.get("type") == "user/message" and source.get("kind") == "goal" and source.get("round") == 1:
            return notification


if goal_control:
    control_url = os.environ["NATIVE_SDK_GOAL_CONTROL_URL"]
    human_text = "Keep this ordinary human input through the Goal pause."
    wake_text = "Wake the parked SDK owner after the Goal pause settles."
    cold_text = "Check the restored Goal before rearming it."
    resume_text = "Explicitly resume the Goal after cold restore."
    session_id = "sdk-goal-control"
    stage = "start Python SDK Goal lifecycle"

    def report_stage(value):
        nonlocal_stage[0] = value
        print(f"native SDK Goal Python stage: {value}", file=sys.stderr)

    nonlocal_stage = [stage]

    def diagnostics():
        try:
            with urlopen(f"{control_url}/goal-diagnostics", timeout=2) as response:
                return json.loads(response.read().decode())
        except BaseException as failure:
            return {"diagnosticsError": repr(failure)}

    def endpoint(path, expected, description):
        report_stage(description)
        try:
            with urlopen(f"{control_url}/{path}", timeout=15) as response:
                actual = response.read().decode()
            if actual != expected:
                raise AssertionError(f"expected {expected!r}, received {actual!r}")
        except BaseException as failure:
            raise RuntimeError(f"native SDK Goal Python stage {description}; evidence={diagnostics()}") from failure

    def cleanup_failed_run(primary, harness, tree=None):
        failures = []
        try:
            with urlopen(f"{control_url}/release-goal-pause", timeout=2) as response:
                if response.read().decode() != "released":
                    raise RuntimeError("pause release endpoint rejected cleanup")
        except BaseException as failure:
            failures.append(failure)
        if tree is not None:
            try:
                tree.close()
            except BaseException as failure:
                failures.append(failure)
        try:
            harness.close()
        except BaseException as failure:
            failures.append(failure)
        if failures:
            raise CleanupFailed(primary, failures) from primary

    def bounded_call(operation, description, harness, tree=None):
        report_stage(description)
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(operation)
            try:
                return future.result(timeout=15)
            except BaseException as failure:
                cleanup_failed_run(failure, harness, tree)
                raise RuntimeError(f"native SDK Goal Python stage {description}; evidence={diagnostics()}") from failure

    def bounded_run(session, text, description, harness):
        return bounded_call(lambda: session.run(text), description, harness)

    with DeepSeekHarness(config) as harness:
        session = harness.start_session(session_id)
        harness.start()
        tree = harness.client.subscribe_session_notifications(session_id)

        report_stage("start bootstrap SDK prompt")
        with ThreadPoolExecutor(max_workers=3) as executor:
            initial = executor.submit(session.run, task)
            goal_input = executor.submit(_wait_for_goal_input, tree, session_id)
            initial_pending = initial
            try:
                while True:
                    watched = [goal_input] if initial_pending is None else [goal_input, initial_pending]
                    done, _ = wait(watched, timeout=15, return_when=FIRST_COMPLETED)
                    if not done:
                        raise RuntimeError(f"native SDK Goal Python stage wait for Goal event; evidence={diagnostics()}")
                    if goal_input in done:
                        goal_notification = goal_input.result()
                        break
                    initial_pending.result()
                    initial_pending = None

                endpoint("await-goal-round-one", "started", "wait for the round-1 provider request to start")
                human_message_id = bounded_call(lambda: session.steer(human_text),
                    "persist ordinary human next-step input during the Goal request", harness, tree)
                endpoint("release-goal-pause", "released", "release the controlled Goal pause")
                endpoint("await-goal-pause-settled", "settled", "wait for the Goal pause to settle and park the root")
                wake_message_id = bounded_call(lambda: session.steer(wake_text),
                    "wake the parked root with a second ordinary human steer", harness, tree)
                report_stage("settle retained human inputs through the original SDK run")
                try:
                    initial_result = initial.result(timeout=15)
                except BaseException as failure:
                    raise RuntimeError(f"native SDK Goal Python stage settle retained input; evidence={diagnostics()}") from failure
                runs = {"bootstrap": serialized(initial_result)}
                assert any(event.get("type") == "agent/inbox/spliced"
                    and any(message.get("id") == human_message_id for message in event.get("data", {}).get("inserted", []))
                    for event in initial_result.events)
                assert any(event.get("type") == "agent/inbox/spliced"
                    and any(message.get("id") == wake_message_id for message in event.get("data", {}).get("inserted", []))
                    for event in initial_result.events)
            except BaseException as failure:
                cleanup_failed_run(failure, harness, tree)
                raise
        tree.close()

    with DeepSeekHarness(config) as restored:
        restored_session = restored.start_session(session_id)
        runs["cold"] = serialized(bounded_run(restored_session, cold_text,
            "cold restored SDK admission while Goal is disarmed", restored))
        runs["rearmed"] = serialized(bounded_run(restored_session, resume_text,
            "explicit human Goal rearm on the retained restored SDK Host", restored))
    print(json.dumps({"runs": runs, "goalNotification": {
        "method": goal_notification.method, "params": goal_notification.payload}}))
    raise SystemExit(0)


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
        background_id = next(item.payload["childSessionId"] for item in started.notifications if item.method == "subagent.started")
        while True:
            notification = background_events.next()
            if notification.method == "session.event" and notification.payload["sessionId"] != session.id \
                and notification.payload["event"]["type"] == "tool/call":
                break
        background_notifications = []
        stopped = session.run("stop the background child")
        outputs = [event["data"]["message"]["content"][0] for event in stopped.events if event["type"] == "tool/result"]
        assert "background child live output" in outputs[0]["content"][0]["text"]
        assert "running" in outputs[0]["content"][0]["text"]
        assert "requested cancellation" in outputs[1]["content"][0]["text"]
        assert "cancelled" in outputs[2]["content"][0]["text"]
        assert stopped.final_response == result.final_response
        while True:
            notification = background_events.next()
            background_notifications.append(notification)
            if notification.method == "subagent.finished" and notification.payload["childSessionId"] == background_id:
                break
        expect_finished(background_notifications, background_id, "aborted")
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
    cancelled_id = next(item.payload["childSessionId"] for item in cancelled_child.notifications if item.method == "subagent.started")
    expect_finished(cancelled_child.notifications, cancelled_id, "aborted")
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
        cancelled_epoch = []
        while True:
            notification = tree.next()
            cancelled_epoch.append(notification)
            if notification.method == "session.event" and notification.payload["sessionId"] == continuation_id \
                and notification.payload["event"]["type"] == "turn/end":
                assert notification.payload["event"]["data"]["reason"]["kind"] == "aborted"
                break
        assert any(item.method == "session.event" and item.payload["sessionId"] == continuation_id
            and item.payload["event"]["type"] == "agent/inbox/spliced"
            and any(message["source"]["kind"] == "agent-message"
                and any(block.get("text") == "parked continuation follow-up" for block in message["content"])
                for message in item.payload["event"]["data"]["inserted"]) for item in cancelled_epoch)
        assert not any(item.method == "subagent.finished" and item.payload["childSessionId"] == continuation_id
            for item in cancelled_epoch)
        recovered.close()
        shutdown_notifications = []
        try:
            tree.drain(shutdown_notifications.append)
        except TransportClosedError:
            pass
        expect_finished(cancelled_epoch + shutdown_notifications, continuation_id, "aborted")
with DeepSeekHarness(config) as cold:
    session = cold.start_session("sdk-recorded-fork")
    with cold.client.subscribe_session_notifications(session.id) as tree:
        refused = session.run("refuse invalid continuation recipients")
        refused_results = [event for event in refused.events if event["type"] == "tool/result"]
        assert len(refused_results) == 2 and all(event["data"]["message"]["content"][0]["isError"] is True for event in refused_results)
        sent = session.run("cold resume the continuable child")
        assert next(event for event in sent.events if event["type"] == "tool/result")["data"]["message"]["content"][0]["isError"] is False
        notice = session.run("await the continuation settlement notice")
        assert "Its closing message:" in json.dumps(notice.events)
        assert result.final_response in json.dumps(notice.events)
        session.run("consume the continuation notice")
        completed_epoch = []
        while True:
            notification = tree.next()
            completed_epoch.append(notification)
            if notification.method == "session.event" and notification.payload["sessionId"] == continuation_id \
                and notification.payload["event"]["type"] == "turn/end":
                assert notification.payload["event"]["data"]["reason"]["kind"] == "completed"
                break
        while True:
            notification = tree.next()
            completed_epoch.append(notification)
            if notification.method == "subagent.finished" and notification.payload["childSessionId"] == continuation_id:
                break
        expect_finished(completed_epoch, continuation_id, "completed")

with DeepSeekHarness(config) as catalog:
    listed = catalog.start_session("sdk-recorded-turn").run("catalog descendants through fork")
    content = next(event for event in listed.events if event["type"] == "tool/result")["data"]["message"]["content"][0]
    assert content["isError"] is False
    rows = json.loads(content["content"][0]["text"])
    assert rows == [{"kind": "child", "id": continuation_id, "label": "continuable child",
        "status": "ready", "parent": "sdk-recorded-fork", "depth": 2}]

print(json.dumps({"finalResponse": result.final_response, "events": result.events,
    "notifications": [{"method": item.method, "params": item.payload} for item in result.notifications]}))
