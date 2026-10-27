"""Route encoded opaque IDs without treating their escaped slashes as separators."""

from urllib.parse import quote, unquote

from fastapi.routing import APIRoute
from starlette.routing import Match
from starlette.types import Scope


class EncodedParameterRoute(APIRoute):
    """Match raw URI boundaries, then decode only this route's captures once.

    ASGI raw_path is optional. Without it, retain the stack's normal decoded
    matching; encoded boundary information cannot be recovered from path.
    The request scope itself (including path/root_path) is never replaced.
    """

    def matches(self, scope: Scope) -> tuple[Match, Scope]:
        raw_path = scope.get("raw_path")
        if scope["type"] != "http" or raw_path is None:
            return super().matches(scope)
        match_scope = dict(scope)
        match_scope["path"] = raw_path.decode("ascii")
        match_scope["root_path"] = quote(scope.get("root_path", ""), safe="/")
        match, child_scope = super().matches(match_scope)
        if match != Match.NONE:
            params = dict(child_scope["path_params"])
            for name in self.param_convertors:
                if name in params:
                    params[name] = unquote(params[name])
            child_scope["path_params"] = params
        return match, child_scope
