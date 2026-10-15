"""Command line entry point for Ontocurator."""

from __future__ import annotations

import contextlib
import ipaddress
import json
import os
import tempfile
from importlib import metadata
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import urlsplit

import typer
import uvicorn

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.domain.errors import DomainError

app = typer.Typer(
    name="ontocurator",
    help="Server for annotating and reviewing ontology concepts on clinical texts.",
    no_args_is_help=True,
)


def get_version() -> str:
    """Installed package version (single source of truth: pyproject.toml)."""
    try:
        return metadata.version("ontocurator")
    except metadata.PackageNotFoundError:
        return "0+unknown"


@app.command()
def version() -> None:
    """Print current version of Ontocurator."""
    typer.echo(get_version())


@app.command("analyze")
def analyze_command(
    package: Annotated[Path, typer.Argument(help="Exported v2 work package ZIP.")],
    output: Annotated[
        Path | None,
        typer.Option(
            "--output", "-o", help="Write analysis JSON here; otherwise print it."
        ),
    ] = None,
    annotator: Annotated[
        list[str] | None,
        typer.Option(
            "--annotator",
            help="Expected annotator ID (repeatable); absent work is reported.",
        ),
    ] = None,
    mode: Annotated[
        str | None,
        typer.Option("--mode", help="Filter independent, review or assisted work."),
    ] = None,
) -> None:
    """Extract current results and missing/negative/uncertain states for analysis."""
    from typing import cast

    from ontocurator.application.analysis import analyze_package
    from ontocurator.domain.workspace import WorkspaceMode
    from ontocurator.packages.reader import read_package

    if output is not None and output.resolve() == package.resolve():
        raise typer.BadParameter(
            "must differ from the input package", param_hint="--output"
        )

    if mode is not None and mode not in {"independent", "review", "assisted"}:
        raise typer.BadParameter(
            "must be independent, review or assisted", param_hint="--mode"
        )
    try:
        dataset = analyze_package(
            read_package(package),
            annotator_ids=annotator,
            mode=cast(WorkspaceMode | None, mode),
        )
        encoded = json.dumps(dataset, ensure_ascii=False, indent=2) + "\n"
        if output is None:
            typer.echo(encoded, nl=False)
        else:
            tmp_path: Path | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="w",
                    encoding="utf-8",
                    dir=output.parent,
                    suffix=".analysis.tmp",
                    delete=False,
                ) as handle:
                    tmp_path = Path(handle.name)
                    handle.write(encoded)
                os.replace(tmp_path, output)
            finally:
                if tmp_path is not None and tmp_path.exists():
                    tmp_path.unlink()
    except (DomainError, OSError) as exc:
        typer.echo(f"Analysis failed: {exc}", err=True)
        raise typer.Exit(code=1) from exc


def _default_web_dir() -> Path | None:
    """The embedded web UI, else a frontend build in a source checkout."""
    embedded = Path(__file__).parent / "web"
    frontend_dist = Path(__file__).parent.parent.parent / "frontend" / "dist"
    for candidate in (embedded, frontend_dist):
        if (candidate / "index.html").is_file():
            return candidate
    return None


LOOPBACK_NAMES = ("localhost", "127.0.0.1", "::1")


def _is_loopback(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def _trusted_hosts(host: str, public_origin: str | None) -> tuple[str, ...] | None:
    """The host names the server answers to; None if it must not start.

    With a public origin only its host, else on a loopback address the
    loopback names plus the bound address itself (e.g. ``127.0.0.2``). A
    server on another address needs a public origin, or a rebound DNS name
    could reach it.
    """
    if public_origin is not None:
        name = urlsplit(public_origin).hostname
        return (name,) if name else None
    if not _is_loopback(host):
        return None
    bound = host.strip("[]").lower()
    with contextlib.suppress(ValueError):
        bound = str(ipaddress.ip_address(bound))
    return LOOPBACK_NAMES if bound in LOOPBACK_NAMES else (*LOOPBACK_NAMES, bound)


def _base_url(host: str, port: int) -> str:
    return f"http://[{host}]:{port}" if ":" in host else f"http://{host}:{port}"


@app.command()
def serve(
    data_dir: Annotated[
        Path,
        typer.Option(
            "--data-dir",
            envvar="ONTOCURATOR_DATA_DIR",
            help=(
                "Folder for stored files, uploaded ontologies, preferences and "
                "exports (the database is PostgreSQL, see --database-url)."
            ),
        ),
    ] = Path("data"),
    database_url: Annotated[
        str | None,
        typer.Option(
            "--database-url",
            help=(
                "PostgreSQL URL of the application role. Default: "
                "ONTOCURATOR_DATABASE_URL, with the password from "
                "ONTOCURATOR_DATABASE_PASSWORD or ONTOCURATOR_DATABASE_PASSWORD_FILE."
            ),
            show_default=False,
        ),
    ] = None,
    ontology: Annotated[
        list[Path] | None,
        typer.Option(
            "--ontology",
            "-o",
            help="Path to an ontology JSON release file, used in place (repeatable).",
        ),
    ] = None,
    translations_dir: Annotated[
        list[Path] | None,
        typer.Option(
            "--translations-dir",
            help=(
                "Folder with translation files (e.g. hp-de.babelon.tsv) besides "
                "<data-dir>/ontologies (repeatable)."
            ),
        ),
    ] = None,
    host: Annotated[
        str,
        typer.Option("--host", envvar="ONTOCURATOR_HOST", help="Address to bind."),
    ] = "127.0.0.1",
    port: Annotated[
        int,
        typer.Option("--port", envvar="ONTOCURATOR_PORT", help="Port to bind."),
    ] = 8000,
    web_dir: Annotated[
        Path | None,
        typer.Option(
            "--web-dir",
            help="Directory containing built static web assets.",
        ),
    ] = None,
    public_origin: Annotated[
        str | None,
        typer.Option(
            "--public-origin",
            envvar="ONTOCURATOR_PUBLIC_ORIGIN",
            help=(
                "The address people open, e.g. https://editor.example.org. Writes "
                "must come from it; with https the session cookie is Secure. "
                "Default: the address each request names."
            ),
            show_default=False,
        ),
    ] = None,
    verbose: Annotated[
        bool,
        typer.Option(
            "--verbose",
            "-v",
            help="Log every request and uvicorn's informational messages.",
        ),
    ] = False,
) -> None:
    """Start the Ontocurator server.

    The first administrator ('admin') is created on the first start from the
    Argon2id hash in ONTOCURATOR_ADMIN_PASSWORD_HASH or the file named by
    ONTOCURATOR_ADMIN_PASSWORD_HASH_FILE.
    """
    from ontocurator import settings

    try:
        canonical_public_origin = (
            None if public_origin is None else settings.canonical_origin(public_origin)
        )
        admin_password_hash = settings.read_secret("ONTOCURATOR_ADMIN_PASSWORD_HASH")
    except settings.SettingsError as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    trusted_hosts = _trusted_hosts(host, canonical_public_origin)
    if trusted_hosts is None:
        typer.echo(
            f"Error: {host} is not a loopback address. Give --public-origin (or "
            "ONTOCURATOR_PUBLIC_ORIGIN), the address people open, e.g. "
            "https://editor.example.org.",
            err=True,
        )
        raise typer.Exit(code=1)

    ontology_paths: list[Path] = []
    for path in ontology or []:
        resolved = path.resolve()
        if not resolved.is_file():
            typer.echo(f"Error: Ontology file not found at: {path}", err=True)
            raise typer.Exit(code=1)
        ontology_paths.append(resolved)

    translation_dirs: list[Path] = []
    for folder in translations_dir or []:
        resolved = folder.resolve()
        if not resolved.is_dir():
            typer.echo(f"Error: Translations folder not found at: {folder}", err=True)
            raise typer.Exit(code=1)
        translation_dirs.append(resolved)

    resolved_web_dir: Path | None
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
        resolved_web_dir = _default_web_dir()

    workspace = data_dir.resolve()
    try:
        (workspace / "ontologies").mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        typer.echo(f"Error: Cannot create data folder {workspace}: {exc}", err=True)
        raise typer.Exit(code=1) from exc

    config = AppConfig(
        workspace_dir=workspace,
        database_url=database_url,
        ontology_paths=ontology_paths,
        translation_dirs=translation_dirs,
        host=host,
        port=port,
        web_dir=resolved_web_dir,
        public_origin=canonical_public_origin,
        admin_password_hash=admin_password_hash,
        trusted_hosts=trusted_hosts,
    )

    try:
        api_app = create_app(config)
    except DomainError as exc:
        if exc.code == "DATABASE_NOT_MIGRATED":
            details = exc.details if isinstance(exc.details, dict) else {}
            typer.echo(
                "Error: The database schema is at revision "
                f"{details.get('current') or 'none'}, this version needs "
                f"{details.get('head')}. Run 'ontocurator db upgrade' with the "
                "schema owner's credentials first.",
                err=True,
            )
        else:
            typer.echo(f"Error: {exc.code}: {exc.details}", err=True)
        raise typer.Exit(code=1) from exc
    except Exception as exc:
        typer.echo(f"Error: Failed to initialize editor: {exc}", err=True)
        raise typer.Exit(code=1) from exc

    typer.echo(f"Ontocurator {get_version()} is starting.")
    typer.echo("Open this address in your browser and log in:")
    typer.echo(f"  {_base_url(host, port)}/")
    typer.echo(f"Data folder: {workspace}")
    try:
        uvicorn.run(
            api_app,
            host=host,
            port=port,
            log_level="info" if verbose else "warning",
            access_log=verbose,
        )
    finally:
        repo: Any = getattr(api_app.state, "repo", None)
        if repo is not None:
            with contextlib.suppress(Exception):
                repo.db.close()


db_app = typer.Typer(help="Database schema (PostgreSQL).", no_args_is_help=True)
app.add_typer(db_app, name="db")


@db_app.command("upgrade")
def db_upgrade() -> None:
    """Upgrade the schema to this version, as the schema owner.

    Reads ONTOCURATOR_MIGRATION_DATABASE_URL and the password from
    ONTOCURATOR_MIGRATION_DATABASE_PASSWORD or ..._PASSWORD_FILE.
    """
    from ontocurator.settings import SettingsError, database_url
    from ontocurator.storage.schema import upgrade

    try:
        head = upgrade(database_url(prefix="ONTOCURATOR_MIGRATION_DATABASE"))
    except SettingsError as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"Database schema is at revision {head}.")


def main() -> None:
    """Console script entry point."""
    app()


if __name__ == "__main__":
    main()
