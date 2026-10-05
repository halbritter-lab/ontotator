import contextlib
import secrets
import socket
import webbrowser
from pathlib import Path
from typing import Annotated

import typer
import uvicorn

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.config_store import load_persistent_config, save_persistent_config
from ontocurator.domain.errors import DomainError
from ontocurator.ontology.discovery import discover_ontologies

app = typer.Typer(
    name="ontocurator",
    help="Local application for annotating and reviewing ontology concepts on clinical texts.",
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


def _find_next_free_port(
    host: str, start_port: int = 8000, max_attempts: int = 20
) -> int:
    for candidate in range(start_port, start_port + max_attempts):
        if not _is_port_in_use(host, candidate):
            return candidate
    return _find_free_port(host)


@app.command()
def version() -> None:
    """Print current version of Ontocurator."""
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
        int | None,
        typer.Option(
            "--port",
            "-p",
            help="Port to bind the local server (0 or omitted for automatic available port).",
        ),
    ] = None,
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
    package: Annotated[
        Path | None,
        typer.Option(
            "--package",
            help="Path to initial work package ZIP file to import on startup.",
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

    persistent_cfg = load_persistent_config()

    if (
        workspace == Path("./workspace")
        and persistent_cfg.workspace_dir != Path("./workspace")
        and persistent_cfg.workspace_dir.is_dir()
    ):
        workspace = persistent_cfg.workspace_dir

    workspace = workspace.resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "ontologies").mkdir(parents=True, exist_ok=True)

    persistent_cfg.workspace_dir = workspace
    save_persistent_config(persistent_cfg)

    # Discovered ontologies from workspace/ontologies and ./ontologies
    discovered = discover_ontologies([workspace / "ontologies", Path("./ontologies")])
    combined_ontologies: list[Path] = []
    seen: set[Path] = set()

    for p in (ontology or []) + persistent_cfg.ontology_paths + discovered:
        res = p.resolve()
        if res.is_file() and res not in seen:
            seen.add(res)
            combined_ontologies.append(res)

    for ont_p in ontology or []:
        if not ont_p.resolve().exists():
            typer.echo(
                f"Error: Ontology file not found at: {ont_p}",
                err=True,
            )
            raise typer.Exit(code=1)

    ontology_list = combined_ontologies

    if port is not None:
        if port != 0 and _is_port_in_use(host, port):
            typer.echo(
                f"Error: Port {port} is already in use on {host}.",
                err=True,
            )
            raise typer.Exit(code=1)
        actual_port = port if port != 0 else _find_free_port(host)
    else:
        preferred_port = persistent_cfg.port
        if not _is_port_in_use(host, preferred_port):
            actual_port = preferred_port
        else:
            actual_port = _find_next_free_port(host, start_port=preferred_port + 1)
            typer.echo(
                f"Notice: Port {preferred_port} is already in use on {host}; "
                f"using available port {actual_port}."
            )

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
    token_file = workspace / ".session_token"
    if token:
        effective_token = token
    elif token_file.is_file():
        saved = token_file.read_text(encoding="utf-8").strip()
        effective_token = saved if saved else secrets.token_urlsafe(32)
    else:
        effective_token = secrets.token_urlsafe(32)

    with contextlib.suppress(Exception):
        token_file.write_text(effective_token, encoding="utf-8")

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

    if package is not None and package.resolve().is_file():
        try:
            repo = api_app.state.repo
            registry = api_app.state.ontology_registry
            from ontocurator.packages.reader import PackageReader

            with open(package.resolve(), "rb") as f:
                pkg = PackageReader.read_from_stream(f, registry=registry)
                if pkg.manifest.task_profile is not None:
                    services = registry.prepare_package(
                        pkg.manifest.task_profile, pkg.embedded_files
                    )
                    repo.import_package(pkg)
                    for s in services:
                        registry.register_service(s)
            url += f"&package_id={pkg.manifest.package_id}"
        except Exception as exc:
            typer.echo(
                f"Warning: Failed to import initial package {package}: {exc}", err=True
            )

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
    """CLI script entrypoint with safe single argument interpretation."""
    import sys

    if len(sys.argv) == 1:
        sys.argv.append("serve")
    elif len(sys.argv) >= 2 and sys.argv[1] not in {
        "serve",
        "version",
        "--help",
        "-h",
        "--install-completion",
        "--show-completion",
    }:
        if sys.argv[1].startswith("-"):
            # Option passed directly without command (e.g. ontocurator --port 8080) -> route to serve
            sys.argv = [sys.argv[0], "serve", *sys.argv[1:]]
        else:
            arg_path = Path(sys.argv[1])
            remaining = sys.argv[2:]
            if arg_path.exists():
                if arg_path.is_dir():
                    sys.argv = [
                        sys.argv[0],
                        "serve",
                        "--workspace",
                        str(arg_path),
                        *remaining,
                    ]
                elif arg_path.suffix.lower() == ".json":
                    sys.argv = [
                        sys.argv[0],
                        "serve",
                        "--ontology",
                        str(arg_path),
                        *remaining,
                    ]
                elif arg_path.suffix.lower() == ".zip":
                    sys.argv = [
                        sys.argv[0],
                        "serve",
                        "--package",
                        str(arg_path),
                        *remaining,
                    ]
                else:
                    sys.argv = [sys.argv[0], "serve", *remaining]
            else:
                sys.argv = [sys.argv[0], "serve", *remaining]

    app()


if __name__ == "__main__":
    main()
