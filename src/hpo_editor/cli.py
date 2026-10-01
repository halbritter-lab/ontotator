"""CLI entry points for local HPO annotation editor."""

import secrets
import socket
import webbrowser
from pathlib import Path
from typing import Annotated

import typer
import uvicorn

from hpo_editor.api.app import create_app
from hpo_editor.config import AppConfig

app = typer.Typer(
    name="hpo-editor",
    help="Local application for annotating and reviewing HPO annotations.",
)


def _find_free_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return int(s.getsockname()[1])


@app.command()
def serve(
    workspace: Annotated[
        Path,
        typer.Option(
            "--workspace",
            "-w",
            help="Directory where packages, drafts, and database are stored.",
        ),
    ] = Path("./workspace"),
    ontology: Annotated[
        Path,
        typer.Option(
            "--ontology",
            "-o",
            help="Path to HPO JSON release file (hp.json).",
        ),
    ] = Path("./hp.json"),
    port: Annotated[
        int,
        typer.Option(
            "--port",
            "-p",
            help="Port to bind the local server (0 for random free port).",
        ),
    ] = 8000,
    host: Annotated[
        str,
        typer.Option(
            "--host",
            help="Host address to bind (must be loopback, e.g. 127.0.0.1).",
        ),
    ] = "127.0.0.1",
    no_browser: Annotated[
        bool,
        typer.Option(
            "--no-browser",
            help="Do not automatically open a web browser.",
        ),
    ] = False,
    web_dir: Annotated[
        Path | None,
        typer.Option(
            "--web-dir",
            help="Directory containing built static web assets.",
        ),
    ] = None,
) -> None:
    """Start local secured HPO annotation editor server."""
    if host not in {"127.0.0.1", "localhost", "::1"}:
        typer.echo(
            f"Error: Host '{host}' is forbidden. Service must bind only to loopback.",
            err=True,
        )
        raise typer.Exit(code=1)

    if not ontology.exists():
        typer.echo(
            f"Error: Ontology file not found at: {ontology.resolve()}",
            err=True,
        )
        raise typer.Exit(code=1)

    workspace = workspace.resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    db_path = workspace / "editor.db"

    actual_port = port if port != 0 else _find_free_port(host)
    token = secrets.token_urlsafe(32)

    config = AppConfig(
        workspace_dir=workspace,
        database_path=db_path,
        ontology_path=ontology.resolve(),
        session_token=token,
        host=host,
        port=actual_port,
        web_dir=web_dir.resolve() if web_dir else None,
    )

    api_app = create_app(config)
    url = f"http://{host}:{actual_port}/#token={token}"

    typer.echo("==================================================")
    typer.echo(f"  HPO Annotation Editor running on port {actual_port}")
    typer.echo(f"  Workspace: {workspace}")
    typer.echo(f"  URL: http://{host}:{actual_port}/")
    typer.echo("==================================================")

    if not no_browser:
        webbrowser.open(url)

    uvicorn.run(api_app, host=host, port=actual_port, log_level="info")


def main() -> None:
    """CLI script entrypoint."""
    app()


if __name__ == "__main__":
    main()
