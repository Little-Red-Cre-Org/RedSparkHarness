from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypeAlias

from pydantic import BaseModel, Field, StrictInt

JsonScalar: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonScalar | dict[str, "JsonValue"] | list["JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]


@dataclass(slots=True)
class Notification:
    method: str
    payload: JsonObject


@dataclass(slots=True)
class IncomingRequest:
    id: str | int
    method: str
    payload: JsonObject


@dataclass(slots=True)
class ApprovalRequest:
    """One Native parent approval question received over the SDK JSON-RPC stream."""

    rpc_id: str | int
    operation_id: str
    request_id: str
    session_id: str
    tool_name: Literal["write_file"]
    call_id: str
    reason: str | None = None

    @classmethod
    def from_incoming(cls, request: IncomingRequest) -> "ApprovalRequest":
        payload = request.payload
        if request.method != "approval/request":
            raise ValueError("IncomingRequest is not an approval/request")
        if not all(isinstance(payload.get(key), str) and payload[key] for key in (
            "operationId", "requestId", "sessionId", "callId"
        )) or payload.get("toolName") != "write_file":
            raise ValueError("approval/request has invalid operation, call, or tool identity")
        reason = payload.get("reason")
        if reason is not None and not isinstance(reason, str):
            raise ValueError("approval/request reason must be a string")
        return cls(
            rpc_id=request.id,
            operation_id=payload["operationId"],
            request_id=payload["requestId"],
            session_id=payload["sessionId"],
            tool_name="write_file",
            call_id=payload["callId"],
            reason=reason,
        )


ApprovalOutcome: TypeAlias = Literal["allowed-once", "rejected", "cancelled", "unavailable"]


class ServerInfo(BaseModel):
    name: str | None = None
    version: str | None = None


class InitializeResponse(BaseModel):
    serverInfo: ServerInfo | None = None
    maxSteps: StrictInt | None = Field(default=None, gt=0, le=9_007_199_254_740_991)
