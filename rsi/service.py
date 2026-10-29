
class Service:
    """A handle on the HTTP service a client talks to.

    The client never imports the agent and never calls it: it posts a task and
    follows the event stream. Whether the service lives in this process or
    another one is decided at startup, not here, so there is exactly one way a
    run happens.
    """

    def __init__(self, base_url: str, *, owned=None) -> None:
        self.base_url = base_url.rstrip("/")
        self._owned = owned

    @classmethod
    def spawn(cls, *, store=None, sessions=None, store_root=None, surface=None):
        """Start a service in this process and return a handle that owns it."""
        from pathlib import Path

        from .server import serve, url_of

        if sessions is None and store_root is not None:
            from .sessions import SessionStore
            sessions = SessionStore(Path(store_root).parent)
        httpd, app, _thread = serve(
            store_root, surface, store=store, sessions=sessions, port=0,
        )
        return cls(url_of(httpd), owned=(httpd, app))

    @classmethod
    def attach(cls, base_url: str):
        """Use a service that is already running, without taking ownership."""
        return cls(base_url)

    @property
    def app(self):
        return self._owned[1] if self._owned else None

    def close(self) -> None:
        """Stop a service this handle owns. Attached handles are left alone."""
        if not self._owned:
            return
        httpd, app = self._owned
        # Tell the stream loop to stop before the socket goes away, or it sits
        # in a poll until the shutdown reaches it. Then close the listener:
        # shutdown() stops serving but leaves the fd bound.
        try:
            app.stopped.set()
            app.events.close()
        except Exception:
            pass
        # The executor owns the long-lived engine process; leaving it behind
        # would orphan one engine per service, each holding a workspace open.
        try:
            closer = getattr(app.executor, "close", None)
            if closer is not None:
                closer()
        except Exception:
            pass
        httpd.shutdown()
        httpd.server_close()
        self._owned = None

    # -- wire ----------------------------------------------------------

    def _post(self, path, payload, timeout=30.0):
        import json
        import urllib.request

        req = urllib.request.Request(
            self.base_url + path,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
        )
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())

    def _get(self, path, timeout=30.0):
        import json
        import urllib.request

        with urllib.request.urlopen(self.base_url + path, timeout=timeout) as r:
            return json.loads(r.read())

    def start(self, task, *, session=None, model=None, reasoning=None):
        """Post a task. `reasoning` is the effort level, or None for the model's own default."""
        return self._post(
            "/run",
            {"task": task, "session": session, "model": model, "reasoning": reasoning},
        )

    def state(self, run_id):
        return self._get("/runs/" + run_id)

    def models(self):
        """The model ids on offer, as the service sees them."""
        return self._get("/models").get("models") or []

    def since(self, seq):
        """Events after `seq` that exist now, without waiting for more.

        /events is a stream and holds the connection open, which is right for a
        long-lived follower and wrong for a poll: a poll that blocks until the
        next event would freeze the caller. /events/since answers with what is
        already there and returns.
        """
        data = self._get("/events/since?after=" + str(int(seq)))
        # How many events the log had already dropped, if the cursor fell behind.
        self.dropped = int(data.get("dropped") or 0)
        return data.get("events") or []
