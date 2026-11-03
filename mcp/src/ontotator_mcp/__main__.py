"""``ontotator-mcp``: run the MCP server over stdio."""

from __future__ import annotations

import logging
import sys

from ontotator_mcp.config import ConfigError, Settings
from ontotator_mcp.server import build_server


def main() -> None:
    # stdout carries the MCP protocol; every log line goes to stderr.
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    # Request lines are not secret, but keep the HTTP client quiet anyway.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        settings = Settings.from_env()
    except ConfigError as exc:
        print(f"ontotator-mcp: {exc}", file=sys.stderr)
        raise SystemExit(2) from None
    build_server(settings).run("stdio")


if __name__ == "__main__":
    main()
