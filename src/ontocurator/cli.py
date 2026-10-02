"""CLI entry points for local HPO annotation editor."""

import secrets
import socket
import webbrowser
from pathlib import Path
from typing import Annotated

import typer
import uvicorn

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.domain.errors import DomainError

app = typer.Typer(
    name="hpo-editor",
    help="Local application for annotating and reviewing HPO annotations.",
    no_args_is_help=True,
)


def _find_free_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return int(s.getsockname()[1])


def _is_port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return False
        except OSError:
            return True


@app.command()
def version() -> None:
    """Print current version of HPO Annotation Editor."""
    typer.echo("0.1.0")


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
        list[Path] | None,
        typer.Option(
            "--ontology",
            "-o",
            help="Path to ontology JSON release file (repeatable).",
        ),
    ] = None,
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
    axes_config: Annotated[
        Path | None,
        typer.Option(
            "--axes-config",
            help="Path to JSON file defining an AxesConfig profile fallback.",
        ),
    ] = None,
    token: Annotated[
        str | None,
        typer.Option(
            "--token",
            "-t",
            help="Custom session token (generated or restored automatically if omitted).",
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

    ontology_list = [p.resolve() for p in (ontology or [])]
    for ont_p in ontology_list:
        if not ont_p.exists():
            typer.echo(
                f"Error: Ontology file not found at: {ont_p}",
                err=True,
            )
            raise typer.Exit(code=1)

    if port != 0 and _is_port_in_use(host, port):
        typer.echo(
            f"Error: Port {port} is already in use on {host}.",
            err=True,
        )
        raise typer.Exit(code=1)

    resolved_web_dir: Path | None = None
    if web_dir is not None:
        resolved_web_dir = web_dir.resolve()
        if not resolved_web_dir.is_dir():
            typer.echo(
                f"Error: Specified web assets directory not found at: "
                f"{resolved_web_dir}",
                err=True,
            )
            raise typer.Exit(code=1)
    else:
        embedded = Path(__file__).parent / "web"
        frontend_dist = Path(__file__).parent.parent.parent / "frontend" / "dist"
        if embedded.is_dir() and (embedded / "index.html").is_file():
            resolved_web_dir = embedded
        elif frontend_dist.is_dir() and (frontend_dist / "index.html").is_file():
            resolved_web_dir = frontend_dist

    workspace = workspace.resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    db_path = workspace / "editor.db"

    actual_port = port if port != 0 else _find_free_port(host)
    token_file = workspace / ".session_token"
    if token:
        effective_token = token
    elif token_file.is_file():
        saved = token_file.read_text(encoding="utf-8").strip()
        effective_token = saved if saved else secrets.token_urlsafe(32)
    else:
        effective_token = secrets.token_urlsafe(32)

    try:
        token_file.write_text(effective_token, encoding="utf-8")
    except Exception:
        pass

    parsed_axes_config = None
    if axes_config is not None:
        resolved_axes_path = axes_config.resolve()
        if not resolved_axes_path.is_file():
            typer.echo(
                f"Error: Axes config file not found at: {resolved_axes_path}",
                err=True,
            )
            raise typer.Exit(code=1)
        try:
            from ontocurator.domain.axes import AxesConfig

            parsed_axes_config = AxesConfig.model_validate_json(
                resolved_axes_path.read_text(encoding="utf-8")
            )
        except Exception as exc:
            typer.echo(
                f"Error: Failed to parse axes configuration: {exc}",
                err=True,
            )
            raise typer.Exit(code=1) from exc

    config = AppConfig(
        workspace_dir=workspace,
        database_path=db_path,
        ontology_path=ontology_list[0] if ontology_list else None,
        ontology_paths=ontology_list,
        session_token=effective_token,
        host=host,
        port=actual_port,
        web_dir=resolved_web_dir,
        axes_config=parsed_axes_config,
    )

    try:
        api_app = create_app(config)
    except DomainError as exc:
        if exc.code == "UNKNOWN_DB_VERSION":
            typer.echo(
                f"Error: Newer database version detected: {exc.details}",
                err=True,
            )
        else:
            typer.echo(f"Error: {exc.code}: {exc.details}", err=True)
        raise typer.Exit(code=1) from exc
    except Exception as exc:
        typer.echo(f"Error: Failed to initialize editor: {exc}", err=True)
        raise typer.Exit(code=1) from exc

    url = f"http://{host}:{actual_port}/#token={effective_token}"

    typer.echo("==================================================")
    typer.echo(f"  Ontocurator running on port {actual_port}")
    typer.echo(f"  Workspace: {workspace}")
    typer.echo(f"  URL: {url}")
    typer.echo(f"  Token: {effective_token}")
    typer.echo("==================================================")

    if not no_browser:
        webbrowser.open(url)

    uvicorn.run(api_app, host=host, port=actual_port, log_level="info")


def main() -> None:
    """CLI script entrypoint."""
    app()


if __name__ == "__main__":
    main()
