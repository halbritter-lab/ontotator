"""``ontotator-mcp``: run the MCP server over stdio."""

from __future__ import annotations

import argparse
import logging
import sys

from ontotator_mcp import __version__
from ontotator_mcp.config import ConfigError, Settings

DESCRIPTION = """\
MCP server for an Ontotator instance. It speaks MCP over stdio, so an MCP
client (Claude Code, Claude Desktop) starts it; it is not run by hand.
"""

EPILOG = """\
environment:
  ONTOTATOR_URL            address of the instance (https; plain http only for
                           localhost or with ONTOTATOR_ALLOW_HTTP=1)
  ONTOTATOR_TOKEN          API token (ott_...)
  ONTOTATOR_ALLOW_HTTP     1 allows plain http to another host
  ONTOTATOR_TIMEOUT        seconds per HTTP request (default 60)
  ONTOTATOR_JOB_TIMEOUT    seconds a tool waits for a job (default 900)
  ONTOTATOR_MCP_FILES_DIR  folders the tools may read and write local files
                           in, separated by the path separator (recommended)
"""


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="ontotator-mcp",
        description=DESCRIPTION,
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--version", action="version", version=f"ontotator-mcp {__version__}"
    )
    parser.parse_args(argv)
    # stdout carries the MCP protocol; every log line goes to stderr.
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    # Request lines are not secret, but keep the HTTP client quiet anyway.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        settings = Settings.from_env()
    except ConfigError as exc:
        print(f"ontotator-mcp: {exc}", file=sys.stderr)
        raise SystemExit(2) from None
    # Imported here, so that --help and --version answer without loading MCP.
    from ontotator_mcp.server import build_server

    build_server(settings).run("stdio")


if __name__ == "__main__":
    main()
