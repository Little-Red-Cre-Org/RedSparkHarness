"""Carry ACP over a process's stdin and stdout.

`acp_server` speaks ACP over a WebSocket, which is how a client that connects to
an already-running server drives it. Other clients do the opposite: they spawn
the agent as a child process and speak newline-delimited JSON-RPC over the two
pipes they gave it. OpenBitFun is one of those, and its configuration for an
external agent carries only `command`, `args` and `env`
(`desktop/src/crates/interfaces/acp/src/client/manager.rs:1757-1767`), so there
is no address it could be pointed at instead.

This module is that second transport and nothing else. What a method means, and
what each answers, belongs to `acp_server`; a frame read here goes to
`AcpServer._serve_frame` and whatever that sends comes back out as one line. That
seam is why the WebSocket path does not have to change and does not have to be
retested.

Three details decide whether this works against the real client:

* **One frame per line, in bytes.** The client frames on newline
  (`agent-client-protocol-0.12.1/src/jsonrpc.rs`, `ByteStreams`:
  `BufReader::new(incoming).lines()` on the way in, `bytes.push(b'\\n')` on the
  way out). Writing through `sys.stdout` would encode in whatever the locale
  says -- measured as `gbk` here -- and the first non-ASCII character would send
  a line the client cannot decode.
* **A reply may be several frames.** `session/prompt` streams updates while it
  runs, so a request cannot hold the reader: the client's `session/cancel`
  arrives on the same pipe and would queue behind it forever.
* **stdout carries frames only.** One stray `print` from any imported module is
  a malformed frame the client never asked for, so logging goes to stderr.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Callable

from . import acp_server

_log = logging.getLogger("rsi.acp_stdio")

#: The store the engine home is derived from when `--home` is not given. The
#: same default the desktop client's `--store` uses, and overridable through the
#: environment for the same reason: a client's `env` block is where a deployment
#: names its directories, so an absolute path does not have to be baked into
#: `args` where it would break on the next machine.
DEFAULT_STORE = ".rsi/store"

#: What every session opened on this transport is tagged with. There is only one
#: connection here, so it exists to keep the argument meaningful rather than to
#: tell sessions apart; passing it keeps both transports calling `_serve_frame`
#: the same way.
CONNECTION = "stdio"


class StdioServer:
    """One ACP connection carried by a process's two pipes.

    Args:
        server: The dispatch every frame is handed to, passed in so a test can
            supply a stand-in and never start an engine.
        read_line: Reads one line as bytes, or returns `None` at end of input.
            Called through a thread, so it may block.
        write_line: Writes one `str` -- already encoded and terminated by the
            caller's `bytes` layer -- to the client.
    """

    def __init__(
        self,
        server: acp_server.AcpServer,
        read_line: Callable[[], bytes | None],
        write_line: Callable[[bytes], None],
    ) -> None:
        self._server = server
        self._read_line = read_line
        self._write_line = write_line
        self._pending: set[asyncio.Task] = set()
        # One writer, taken for the duration of one frame. Two prompts running at
        # once each write from their own task; without this their bytes interleave
        # inside a line and the client reads one unparseable frame instead of two.
        self._writing = asyncio.Lock()

    async def _emit(self, frame: dict) -> None:
        """Hand one object to the client. The transport's only output path."""
        payload = (json.dumps(frame, ensure_ascii=False) + "\n").encode("utf-8")
        async with self._writing:
            self._write_line(payload)

    async def serve(self) -> None:
        """Read frames until input ends, then stop every run still in flight.

        Each frame is dispatched on its own task, and the reader does not wait for
        one before reading the next. `session/prompt` answers only when its run
        finishes but streams updates meanwhile, so a reader that waited would
        never get to the cancel the user sends while watching it.
        """
        try:
            while True:
                raw = await asyncio.to_thread(self._read_line)
                if raw is None:
                    return
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                try:
                    frame = json.loads(line)
                except ValueError:
                    await acp_server._send_error(
                        self._emit, None, -32700, "not JSON: " + line[:120]
                    )
                    continue
                if not isinstance(frame, dict):
                    await acp_server._send_error(
                        self._emit, None, -32600, "a frame is a JSON object"
                    )
                    continue
                task = asyncio.create_task(self._serve_one(frame))
                self._pending.add(task)
                task.add_done_callback(self._pending.discard)
        finally:
            # The obligation the WebSocket path has too: a run left in flight
            # keeps calling tools and billing tokens for a client that is gone.
            await self._shutdown()

    async def _serve_one(self, frame: dict) -> None:
        """Handle one frame, and never let its failure kill the process."""
        try:
            await self._server._serve_frame(frame, self._emit, CONNECTION)
        except Exception as exc:  # noqa: BLE001 - one bad call is not one bad process
            _log.warning("frame failed: %s: %s", type(exc).__name__, exc)

    async def _shutdown(self) -> None:
        """Stop the server and every task still reading or running."""
        try:
            await self._server.aclose()
        except Exception as exc:  # noqa: BLE001 - shutdown must finish
            _log.warning("closing the server failed: %s", exc)
        for task in self._pending:
            task.cancel()
        if self._pending:
            await asyncio.gather(*self._pending, return_exceptions=True)


def engine_home(explicit: Path | str | None = None, store: Path | str | None = None) -> Path:
    """The engine home to serve, resolving the same way the other front ends do.

    An explicit `--home` wins. Otherwise it is derived from the store, exactly as
    `acp_server.run` and the desktop window derive it, so all three read one
    `config.toml` rather than three that can disagree about which provider is in
    use.
    """
    from .models import home_for

    if explicit is not None:
        return Path(explicit)
    root = Path(store) if store is not None else Path(
        os.environ.get("RSI_STORE", DEFAULT_STORE)
    )
    return home_for(root)


def serve_stdio(
    *,
    home: Path | str | None = None,
    model: str | None = None,
    store: Path | str | None = None,
    backend_factory: Callable[[], Any] | None = None,
    stdin: Any = None,
    stdout: Any = None,
) -> None:
    """Serve ACP over stdin and stdout until the client closes the pipe.

    Blocks. Diagnostics go to stderr, because stdout carries frames and nothing
    else.

    Args:
        home: The engine home whose `config.toml` names the provider. Resolved
            from `store` when omitted.
        model: The model every run uses unless the client names one.
        store: The generation store the engine home is derived from. Ignored
            when `home` is given.
        backend_factory: How to build the executor. Passed through to
            `AcpServer` so a test can run the real transport against a stand-in.
        stdin: Readable binary stream. Defaults to `sys.stdin.buffer`.
        stdout: Writable binary stream. Defaults to `sys.stdout.buffer`.
    """
    source = stdin if stdin is not None else sys.stdin.buffer
    sink = stdout if stdout is not None else sys.stdout.buffer

    def read_line() -> bytes | None:
        line = source.readline()
        return line if line else None

    def write_line(payload: bytes) -> None:
        sink.write(payload)
        sink.flush()

    server = acp_server.AcpServer(
        home=engine_home(home, store), model=model, backend_factory=backend_factory
    )
    transport = StdioServer(server, read_line, write_line)
    try:
        asyncio.run(transport.serve())
    finally:
        # `serve` already awaited the close; this covers a loop that died under
        # it, which is the same fallback `acp_server.run` keeps.
        server.close()


def main(argv: list[str] | None = None) -> int:
    """Parse this entry point's arguments and serve.

    stderr is where every diagnostic goes, and stdout is left untouched: the
    client reads it as a frame stream, so a single banner printed here would be
    answered as a request the client never made.
    """
    parser = argparse.ArgumentParser(
        prog="rsi acp-stdio",
        description="Serve ACP over stdio for a client that launches this process.",
    )
    parser.add_argument("--home", default="", help="engine home directory")
    parser.add_argument("--store", default="", help="generation store to derive the home from")
    parser.add_argument("--model", default="", help="model every run uses")
    args = parser.parse_args(argv)

    logging.basicConfig(
        stream=sys.stderr,
        level=logging.INFO,
        format="rsi acp-stdio: %(levelname)s %(message)s",
    )
    serve_stdio(
        home=args.home or None,
        store=args.store or None,
        model=args.model or None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
