"""Python twin for the native SDK staged-file Session replay."""
import base64
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
from urllib.request import Request, urlopen

from deepseek_harness import DeepSeekHarness, DeepSeekHarnessConfig
from deepseek_harness.errors import JsonRpcError

launcher, home, workspace, patch, control_url = sys.argv[1:]
scene = Path(__file__).parent
first_bytes = (scene / "first.txt").read_bytes()
second_bytes = (scene / "second.txt").read_bytes()
image_data = base64.b64encode((scene / "image.png").read_bytes()).decode("ascii")
session_id = "sdk-staged-files"
config = DeepSeekHarnessConfig(dsh_bin=launcher, profile="native-sdk", dsh_home=home,
    patches=(patch,), cwd=workspace, provider="fixture", model="fixture-model",
    allowed_tools=("read_file",), request_timeout_seconds=20,
    env={"NATIVE_SDK_FIXTURE_KEY": "fixture-key", "DSH_TELEMETRY_DISABLED": "1"})


def control(path, method="GET"):
    request = Request(f"{control_url}{path}", data=b"" if method == "POST" else None, method=method)
    with urlopen(request, timeout=30) as response:
        return response.read().decode()


def summary(result):
    return {"finalResponse": result.final_response}


with DeepSeekHarness(config) as harness:
    session = harness.start_session(session_id)
    first_receipt = session.upload_file(first_bytes, "first.txt")
    try:
        session.run([{"type": "file", "attachment": {
            "attachmentId": f"sha256:{'a' * 64}", "name": "forged.txt", "bytes": 1,
        }}])
    except JsonRpcError as error:
        if "content blocks must be text, encoded raster images, or staged file receipts" not in error.message:
            raise
    else:
        raise AssertionError("Native SDK accepted a raw FileAttachmentRef")
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(session.run, [
            {"type": "text", "text": "Read the staged first file and inspect the image."},
            {"type": "image", "data": image_data, "mimeType": "image/png"},
            {"type": "file", "receiptId": first_receipt.receipt_id},
        ])
        control("/await-initial")
        second_receipt = session.upload_file(second_bytes, "second.txt")
        steering_id = session.steer([
            {"type": "text", "text": "Read the second staged file too."},
            {"type": "file", "receiptId": second_receipt.receipt_id},
        ])
        control("/release-initial", "POST")
        first_result = pending.result(timeout=30)

with DeepSeekHarness(config) as cold:
    cold_result = cold.start_session(session_id).run("Cold-read the first staged file again.")

print(json.dumps({
    "firstResult": summary(first_result),
    "coldResult": summary(cold_result),
    "steeringId": steering_id,
    "firstReceipt": first_receipt.model_dump(by_alias=True),
    "secondReceipt": second_receipt.model_dump(by_alias=True),
}))
