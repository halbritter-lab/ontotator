"""Command line entry point and standalone launcher for Ontocurator."""

from __future__ import annotations

import contextlib
import json
import os
import secrets
import signal
import socket
import sys
import tempfile
import threading
import webbrowser
from collections.abc import Callable
from importlib import metadata
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import urlencode

import typer
import uvicorn

from ontocurator import file_manager
from ontocurator.api.app import create_app
from ontocurator.application.legacy_config import (
    LegacyConfigInUse,
    LegacyConfigNotFound,
    delete_legacy_config,
)
from ontocurator.application.provisioning import (
    ProvisioningLedger,
    ProvisioningStatus,
    provision_ontologies,
    provision_packages,
    store_ontology_copy,
)
from ontocurator.application.uploads import PackageImportService
from ontocurator.config import AppConfig
from ontocurator.config_store import (
    app_dir,
    cloud_sync_provider,
    default_provision_dir,
    default_workspace_dir,
    detect_portable_root,
    get_default_config_path,
    legacy_config_path,
    load_persistent_config,
    same_path,
    save_persistent_config,
)
from ontocurator.distribution_settings import (
    SETTINGS_FILENAME,
    DistributionSettings,
    load_settings_file,
)
from ontocurator.domain.errors import DomainError
from ontocurator.instance import (
    LOOPBACK_HOSTS,
    InstanceInfo,
    WorkspaceLock,
    remove_instance_info,
    upload_file,
    wait_for_running_instance,
    write_instance_info,
)
from ontocurator.ontology.discovery import discover_ontologies
from ontocurator.ontology.naming import (  # re-exported for callers/tests
    content_addressed_name as content_addressed_name,
)

app = typer.Typer(
    name="ontocurator",
    help="Local application for annotating and reviewing ontology concepts on clinical texts.",
    no_args_is_help=True,
)

PORT_SEARCH_ATTEMPTS = 20


def get_version() -> str:
    """Installed package version (single source of truth: pyproject.toml)."""
    try:
        return metadata.version("ontocurator")
    except metadata.PackageNotFoundError:
        return "0+unknown"


# --------------------------------------------------------------------------- #
# Port handling: bind first, then hand the bound socket to uvicorn (no race).
# --------------------------------------------------------------------------- #


def _bind_socket(host: str, port: int) -> socket.socket:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    try:
        if sys.platform != "win32":
            # Allow quick restarts (TIME_WAIT); on Windows this would allow
            # stealing a port that is actively in use, so it is not set there.
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((host, port))
        sock.listen(128)
    except OSError:
        sock.close()
        raise
    sock.set_inheritable(True)
    return sock


def bind_server_socket(
    host: str, port: int | None, preferred_port: int
) -> tuple[socket.socket, str | None]:
    """Bind the listening socket.

    ``port`` given (non-zero) must be available; ``0`` picks an ephemeral port;
    ``None`` tries ``preferred_port`` and the following ports, then any port.
    Returns the socket and an optional notice for the user.
    """
    if port is not None:
        return _bind_socket(host, port), None
    for candidate in range(preferred_port, preferred_port + PORT_SEARCH_ATTEMPTS):
        try:
            sock = _bind_socket(host, candidate)
        except OSError:
            continue
        notice = None
        if candidate != preferred_port:
            notice = (
                f"Notice: Port {preferred_port} is already in use on {host}; "
                f"using available port {candidate}."
            )
        return sock, notice
    sock = _bind_socket(host, 0)
    return sock, (
        f"Notice: Ports {preferred_port}-{preferred_port + PORT_SEARCH_ATTEMPTS - 1} "
        f"are in use on {host}; using available port {sock.getsockname()[1]}."
    )


# --------------------------------------------------------------------------- #
# Server lifecycle
# --------------------------------------------------------------------------- #


def _install_windows_close_handler(
    server: uvicorn.Server, finished: threading.Event
) -> Any:
    """Best effort: shut down cleanly when the console window is closed.

    Windows gives a console process a few seconds after CTRL_CLOSE_EVENT /
    logoff / shutdown before killing it; we request a graceful uvicorn exit and
    wait for the cleanup to finish within that window.
    """
    if sys.platform != "win32":
        return None
    try:
        import ctypes
        from ctypes import wintypes

        handler_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)

        def _handler(event: int) -> bool:
            if event in (2, 5, 6):  # CLOSE, LOGOFF, SHUTDOWN
                server.should_exit = True
                finished.wait(4.5)
                return True
            return False  # Ctrl+C / Ctrl+Break: default handling (uvicorn)

        callback = handler_type(_handler)
        ctypes.windll.kernel32.SetConsoleCtrlHandler(callback, True)
        return callback  # keep a reference alive for the process lifetime
    except Exception:
        return None


def run_server(
    api_app: Any,
    sock: socket.socket,
    on_started: Callable[[], None] | None = None,
    finished: threading.Event | None = None,
    verbose: bool = False,
) -> None:
    """Serve ``api_app`` on an already bound socket until interrupted.

    uvicorn handles SIGINT/SIGTERM (and SIGBREAK on Windows) gracefully;
    ``on_started`` runs once the server accepts connections. Without
    ``verbose`` the console stays quiet: no per-request access log and only
    warnings/errors from uvicorn.
    """
    config = uvicorn.Config(
        api_app,
        log_level="info" if verbose else "warning",
        access_log=verbose,
    )
    server = uvicorn.Server(config)
    finished = finished or threading.Event()
    _keepalive = _install_windows_close_handler(server, finished)

    if on_started is not None:

        def _notify() -> None:
            while not server.started:
                if server.should_exit or finished.is_set():
                    return
                finished.wait(0.05)
            on_started()

        threading.Thread(
            target=_notify, name="ontocurator-started", daemon=True
        ).start()

    # uvicorn captures SIGINT/SIGTERM/SIGBREAK while serving and re-raises them
    # after its graceful shutdown. Absorb that re-raise so our own cleanup
    # (closing the database, releasing the workspace lock) still runs instead
    # of the process being killed by the default handler.
    previous: dict[int, Any] = {}
    for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        sig = getattr(signal, name, None)
        if sig is None:
            continue
        with contextlib.suppress(ValueError, OSError):
            previous[sig] = signal.signal(sig, lambda *_: None)
    try:
        server.run(sockets=[sock])
    finally:
        for sig, handler in previous.items():
            with contextlib.suppress(ValueError, OSError, TypeError):
                signal.signal(sig, handler)
        del _keepalive


def _open_browser(url: str) -> None:
    with contextlib.suppress(Exception):
        webbrowser.open(url)


def relaunch_hint() -> str:
    """How to get a fresh browser tab for the running instance."""
    if getattr(sys, "frozen", False):
        return f"double-click {Path(sys.executable).name} again"
    return "start Ontocurator again"


def build_app_url(base_url: str, token: str, package_id: str | None = None) -> str:
    fragment: dict[str, str] = {"token": token}
    if package_id:
        fragment["package_id"] = package_id
    return f"{base_url}/#{urlencode(fragment)}"


# --------------------------------------------------------------------------- #
# Ontology import (drag & drop of a .json onto the executable)
# --------------------------------------------------------------------------- #


def import_ontology_file(source: Path, ontologies_dir: Path) -> Path:
    """Copy a validated OBO Graph JSON into the workspace (idempotent)."""
    return store_ontology_copy(source, ontologies_dir)[0]


def _report(message: str, warning: bool) -> None:
    typer.echo(message, err=warning)


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #


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


def _handoff_to_running_instance(
    workspace: Path,
    *,
    import_ontology: list[Path],
    package: Path | None,
    open_browser: bool,
) -> None:
    typer.echo(f"Ontocurator is already running for workspace: {workspace}")

    def _progress(elapsed: float) -> None:
        typer.echo(
            f"Waiting for the running Ontocurator instance to respond "
            f"({elapsed:.0f}s; it may still be loading ontologies)..."
        )

    info = wait_for_running_instance(workspace, on_progress=_progress)
    if info is None:
        typer.echo(
            "Error: The workspace is locked by another Ontocurator process that "
            "does not respond. Close the other Ontocurator window (or end the "
            "process) and try again.",
            err=True,
        )
        not_imported = [*import_ontology]
        if package is not None:
            not_imported.append(package)
        for path in not_imported:
            how = (
                "use 'Import work package' in the web UI"
                if package is not None and path == package
                else "drop it onto Ontocurator again (or use 'Upload missing "
                "ontology' in the web UI)"
            )
            typer.echo(
                f"The file {path} was NOT imported. Once Ontocurator responds, {how}.",
                err=True,
            )
        raise typer.Exit(code=1)

    for src in import_ontology:
        try:
            upload_file(info, "/api/v1/ontologies", src.resolve())
            typer.echo(f"Sent ontology {src} to the running instance.")
        except Exception as exc:
            typer.echo(f"Warning: Could not import ontology {src}: {exc}", err=True)

    package_id: str | None = None
    if package is not None and package.resolve().is_file():
        try:
            result = upload_file(info, "/api/v1/packages", package.resolve())
            package_id = str(result.get("package_id") or "") or None
            typer.echo(f"Sent work package {package} to the running instance.")
        except Exception as exc:
            typer.echo(f"Warning: Could not import package {package}: {exc}", err=True)

    url = build_app_url(info.base_url, info.token, package_id)
    typer.echo(f"Opening the running instance: {info.base_url}/")
    if open_browser:
        _open_browser(url)
    else:
        typer.echo(f"  URL: {url}")


@app.command()
def serve(
    workspace: Annotated[
        Path | None,
        typer.Option(
            "--workspace",
            "-w",
            help=(
                "Data folder for stored files, ontologies, preferences and "
                "exports (the database is PostgreSQL, see --database-url). "
                "Default: the saved workspace, else ./workspace when run from "
                "source, the app folder's workspace/ for the portable build, or "
                "the local user data folder (e.g. %LOCALAPPDATA%\\Ontocurator\\"
                "workspace) otherwise."
            ),
            show_default=False,
        ),
    ] = None,
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
            help="Path to ontology JSON release file, used in place (repeatable).",
        ),
    ] = None,
    import_ontology: Annotated[
        list[Path] | None,
        typer.Option(
            "--import-ontology",
            help=(
                "Copy an ontology JSON into <workspace>/ontologies and remember it "
                "(repeatable). Used for files dropped onto the executable."
            ),
        ),
    ] = None,
    port: Annotated[
        int | None,
        typer.Option(
            "--port",
            "-p",
            help=(
                "Port to bind (0 = any free port). Omitted: the saved port "
                "(default 8000) or the next free one."
            ),
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
            help="Custom session token (a new random token is generated per start if omitted).",
        ),
    ] = None,
    package: Annotated[
        Path | None,
        typer.Option(
            "--package",
            help="Path to initial work package ZIP file to import on startup.",
        ),
    ] = None,
    print_url: Annotated[
        bool,
        typer.Option(
            "--print-url",
            help=(
                "Also print the full link including the private access key "
                "(always printed with --no-browser)."
            ),
        ),
    ] = False,
    provision_dir: Annotated[
        Path | None,
        typer.Option(
            "--provision-dir",
            help=(
                "Folder with ontologies/*.json, packages/*.zip and an optional "
                f"{SETTINGS_FILENAME} to register/import at start. Default: the "
                "folder of the standalone executable (none when run from source)."
            ),
        ),
    ] = None,
    verbose: Annotated[
        bool,
        typer.Option(
            "--verbose",
            "-v",
            help="Show technical details and log every request in this window.",
        ),
    ] = False,
) -> None:
    """Start the local, secured Ontocurator server."""
    # ---- validate inputs before touching any workspace ----------------------
    if host not in LOOPBACK_HOSTS:
        typer.echo(
            f"Error: Host '{host}' is forbidden. Service must bind only to loopback.",
            err=True,
        )
        raise typer.Exit(code=1)

    for ont_p in ontology or []:
        if not ont_p.resolve().is_file():
            typer.echo(f"Error: Ontology file not found at: {ont_p}", err=True)
            raise typer.Exit(code=1)

    source_dir: Path | None
    if provision_dir is not None:
        source_dir = provision_dir.resolve()
        if not source_dir.is_dir():
            typer.echo(
                f"Error: Provisioning folder not found at: {source_dir}", err=True
            )
            raise typer.Exit(code=1)
    else:
        source_dir = default_provision_dir()

    settings = DistributionSettings()
    if source_dir is not None:
        settings, settings_warnings = load_settings_file(source_dir / SETTINGS_FILENAME)
        for warning in settings_warnings:
            typer.echo(f"Warning: {warning}", err=True)

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
            typer.echo(f"Error: Failed to parse axes configuration: {exc}", err=True)
            raise typer.Exit(code=1) from exc

    # ---- resolve workspace (never silently) --------------------------------
    # Settings of an earlier per-user installation are never imported here:
    # the web UI offers that (and nothing at all for a preconfigured bundle).
    config_path = get_default_config_path()
    portable_root = detect_portable_root()
    persistent_cfg = load_persistent_config(config_path)
    preconfigured = (
        source_dir is not None and (source_dir / SETTINGS_FILENAME).is_file()
    )

    if workspace is not None:
        ws = workspace.resolve()
        ws_source = "command line / opened folder"
    elif "workspace_dir" in persistent_cfg.model_fields_set:
        saved = persistent_cfg.workspace_dir
        if saved.is_dir():
            ws = saved.resolve()
            ws_source = f"saved in {config_path}"
        else:
            ws = default_workspace_dir()
            ws_source = "default"
            typer.echo(
                f"Notice: The saved workspace {saved} does not exist anymore; "
                f"using the default workspace {ws} instead.",
                err=True,
            )
    else:
        ws = default_workspace_dir()
        ws_source = "default (portable app folder)" if portable_root else "default"

    try:
        ws.mkdir(parents=True, exist_ok=True)
        (ws / "ontologies").mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        typer.echo(f"Error: Cannot create workspace {ws}: {exc}", err=True)
        raise typer.Exit(code=1) from exc

    # Precedence: command line > ontocurator-settings.json > config.json.
    auto_open = (
        settings.auto_open_browser
        if settings.auto_open_browser is not None
        else persistent_cfg.auto_open_browser
    )
    open_browser = not no_browser and auto_open
    sync_provider = cloud_sync_provider(ws)
    if sync_provider is not None:
        typer.echo(
            f"Warning: Workspace {ws} is inside a {sync_provider} folder. Cloud "
            "synchronisation can interfere with the files Ontocurator writes "
            "there while it is running; use a local folder or pause syncing.",
            err=True,
        )

    # ---- single instance per workspace -------------------------------------
    lock = WorkspaceLock(ws)
    try:
        acquired = lock.acquire()
    except OSError as exc:
        typer.echo(f"Error: Cannot lock workspace {ws}: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    if not acquired:
        _handoff_to_running_instance(
            ws,
            import_ontology=list(import_ontology or []),
            package=package,
            open_browser=open_browser,
        )
        return

    sock: socket.socket | None = None
    api_app: Any = None
    finished = threading.Event()
    try:
        # ---- ontologies ------------------------------------------------------
        for src in import_ontology or []:
            try:
                dest = import_ontology_file(src.resolve(), ws / "ontologies")
            except Exception as exc:
                typer.echo(
                    f"Warning: Ignoring ontology {src}: {exc}",
                    err=True,
                )
                continue
            typer.echo(f"Imported ontology {src} -> {dest}")
            if dest.resolve() not in [
                p.resolve() for p in persistent_cfg.ontology_paths
            ]:
                persistent_cfg.ontology_paths.append(dest.resolve())

        # ---- preconfigured distribution: ontologies/ (before packages) ------
        ledger = ProvisioningLedger(ws)
        provisioning = ProvisioningStatus()
        if source_dir is not None:
            for dest in provision_ontologies(
                source_dir, ws / "ontologies", ledger, provisioning, _report
            ):
                if dest.resolve() not in [
                    p.resolve() for p in persistent_cfg.ontology_paths
                ]:
                    persistent_cfg.ontology_paths.append(dest.resolve())

        persistent_cfg.workspace_dir = ws
        try:
            save_persistent_config(persistent_cfg, config_path)
        except OSError as exc:
            typer.echo(
                f"Warning: Could not save settings to {config_path}: {exc}", err=True
            )

        # <workspace>/ontologies plus ./ontologies next to the executable
        # (frozen) or in the current directory (from source).
        search_dirs = [ws / "ontologies", app_dir() / "ontologies"]
        discovered = discover_ontologies(search_dirs)
        ontology_list: list[Path] = []
        seen: set[Path] = set()
        for p in (ontology or []) + persistent_cfg.ontology_paths + discovered:
            res = p.resolve()
            if res.is_file() and res not in seen:
                seen.add(res)
                ontology_list.append(res)

        # ---- socket ----------------------------------------------------------
        try:
            sock, notice = bind_server_socket(host, port, persistent_cfg.port)
        except OSError as exc:
            typer.echo(
                f"Error: Port {port} is already in use on {host} ({exc}).", err=True
            )
            raise typer.Exit(code=1) from exc
        if notice:
            typer.echo(notice)
        actual_port = int(sock.getsockname()[1])

        effective_token = token or secrets.token_urlsafe(32)

        config = AppConfig(
            workspace_dir=ws,
            database_url=database_url,
            ontology_path=ontology_list[0] if ontology_list else None,
            ontology_paths=ontology_list,
            # Translation files lie next to the ontologies. The workspace
            # folder is always searched; these are the delivery folders.
            translation_dirs=[
                app_dir() / "ontologies",
                *([source_dir / "ontologies"] if source_dir is not None else []),
            ],
            session_token=effective_token,
            host=host,
            port=actual_port,
            web_dir=resolved_web_dir,
            axes_config=parsed_axes_config,
            distribution=settings,
            config_path=config_path,
            legacy_config_path=legacy_config_path(),
            preconfigured=preconfigured,
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

        repo = api_app.state.repo
        registry = api_app.state.ontology_registry

        # ---- preconfigured distribution: packages/ ---------------------------
        if source_dir is not None:
            provision_packages(
                source_dir, repo, registry, ledger, provisioning, _report
            )
            try:
                ledger.save()
            except OSError as exc:
                typer.echo(f"Warning: Could not save {ledger.path}: {exc}", err=True)
        api_app.state.provisioning = provisioning

        package_id: str | None = None
        if package is not None and package.resolve().is_file():
            try:
                with open(package.resolve(), "rb") as f:
                    manifest = PackageImportService(repo, registry).import_upload(f)
                package_id = manifest.package_id
            except Exception as exc:
                typer.echo(
                    f"Warning: Failed to import initial package {package}: {exc}",
                    err=True,
                )
        if package_id is None and settings.open_package:
            if repo.manifest_hash(settings.open_package) is not None:
                package_id = settings.open_package
            else:
                typer.echo(
                    f"Warning: open_package '{settings.open_package}' from "
                    f"{SETTINGS_FILENAME} is not an imported work package.",
                    err=True,
                )

        info = InstanceInfo(
            pid=os.getpid(), host=host, port=actual_port, token=effective_token
        )
        write_instance_info(ws, info)
        url = build_app_url(info.base_url, effective_token, package_id)

        rule = "=" * 66
        typer.echo(rule)
        if open_browser:
            typer.echo(
                "  Ontocurator is running. Your browser should open automatically."
            )
        else:
            typer.echo("  Ontocurator is running.")
        typer.echo("  Keep this window open while you work; to quit, press Ctrl+C")
        typer.echo("  or close this window.")
        typer.echo("")
        typer.echo(f"  Address:     {info.base_url}/")
        if open_browser:
            typer.echo(f"  If the browser did not open, {relaunch_hint()}.")
        if not open_browser or print_url:
            typer.echo("  Open this link in your browser (it contains a private key):")
            typer.echo(f"  {url}")
        typer.echo(f"  Data folder: {ws}")
        if verbose:
            typer.echo(f"               ({ws_source})")
            typer.echo(f"  Settings:    {config_path}")
            if source_dir is not None:
                typer.echo(f"  Preloads:    {source_dir}")
            typer.echo(f"  Version:     {get_version()}")
        if sync_provider is not None:
            typer.echo("")
            typer.echo(
                f"  Warning: the data folder is inside a {sync_provider} folder."
            )
            typer.echo("  Cloud sync can interfere with the files written there.")
            typer.echo("  Prefer a local folder (see README 'Where data lives') or")
            typer.echo("  pause syncing.")
        typer.echo(rule)

        def _on_started() -> None:
            if open_browser:
                _open_browser(url)

        run_server(
            api_app, sock, on_started=_on_started, finished=finished, verbose=verbose
        )
    finally:
        if api_app is not None:
            repo = getattr(api_app.state, "repo", None)
            if repo is not None:
                with contextlib.suppress(Exception):
                    repo.db.close()
        if sock is not None:
            with contextlib.suppress(OSError):
                sock.close()
        remove_instance_info(ws)
        lock.release()
        finished.set()
        if api_app is not None:
            typer.echo(f"Ontocurator stopped. Your data is stored in {ws}")


# --------------------------------------------------------------------------- #
# Settings locations (for administrators)
# --------------------------------------------------------------------------- #


def _saved_workspace(config_path: Path) -> Path:
    """The workspace ``serve`` would use without --workspace."""
    saved = load_persistent_config(config_path)
    if "workspace_dir" in saved.model_fields_set and saved.workspace_dir.is_dir():
        return saved.workspace_dir.resolve()
    return default_workspace_dir()


@app.command("config")
def config_command(
    path: Annotated[
        bool,
        typer.Option(
            "--path",
            help=(
                "Show the settings file in use, the settings file of an earlier "
                "installation (if any) and the data folder (default action)."
            ),
        ),
    ] = False,
    open_folder: Annotated[
        bool,
        typer.Option("--open", help="Open the folder of the settings file in use."),
    ] = False,
    delete_legacy: Annotated[
        bool,
        typer.Option(
            "--delete-legacy",
            help=(
                "Delete the settings file of an earlier installation. Workspaces "
                "and annotations are not affected."
            ),
        ),
    ] = False,
    yes: Annotated[
        bool,
        typer.Option("--yes", "-y", help="Do not ask before deleting."),
    ] = False,
) -> None:
    """Show or manage where Ontocurator keeps its settings."""
    config_path = get_default_config_path()
    legacy = legacy_config_path()
    is_active = same_path(legacy, config_path)

    if path or not (open_folder or delete_legacy):
        typer.echo(f"Settings file in use: {config_path}")
        if is_active:
            typer.echo(
                "Settings from an earlier installation: none (this installation "
                "uses the per-user settings file)"
            )
        elif legacy.is_file():
            typer.echo(f"Settings from an earlier installation: {legacy}")
        else:
            typer.echo("Settings from an earlier installation: none found")
        typer.echo(f"Data folder (workspace): {_saved_workspace(config_path)}")

    if open_folder:
        folder = config_path.parent
        if not folder.is_dir():
            typer.echo(
                f"The settings folder {folder} does not exist yet; it is created "
                "when Ontocurator starts for the first time.",
                err=True,
            )
            raise typer.Exit(code=1)
        try:
            file_manager.open_folder(folder)
        except OSError as exc:
            typer.echo(f"Error: Could not open {folder}: {exc}", err=True)
            raise typer.Exit(code=1) from exc
        typer.echo(f"Opened {folder}")

    if delete_legacy:
        if is_active:
            typer.echo(
                f"Error: {legacy} is the settings file this installation uses; "
                "it is not deleted.",
                err=True,
            )
            raise typer.Exit(code=1)
        if not legacy.is_file():
            typer.echo("No settings file from an earlier installation was found.")
            return
        typer.echo(f"This deletes only the file {legacy}")
        typer.echo("(and its folder, if it is then empty).")
        typer.echo("No workspace, annotation or ontology data is affected.")
        if not yes and not typer.confirm("Delete it?", default=False):
            typer.echo("Nothing was deleted.")
            raise typer.Exit(code=1)
        try:
            delete_legacy_config(legacy, config_path)
        except (LegacyConfigInUse, LegacyConfigNotFound) as exc:
            typer.echo(f"Error: {exc.details}", err=True)
            raise typer.Exit(code=1) from exc
        except OSError as exc:
            typer.echo(f"Error: Could not delete {legacy}: {exc}", err=True)
            raise typer.Exit(code=1) from exc
        typer.echo(f"Deleted {legacy}")


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


# --------------------------------------------------------------------------- #
# Zero-CLI entry point (double click / drag & drop / "Open with")
# --------------------------------------------------------------------------- #

PASSTHROUGH_FIRST_ARGS = {
    "serve",
    "version",
    "config",
    "analyze",
    "db",
    "--help",
    "-h",
    "--install-completion",
    "--show-completion",
}


def route_positional_args(paths: list[str]) -> tuple[list[str], list[str]]:
    """Translate OS-provided paths into ``serve`` options.

    Returns ``(serve_options, ignored_messages)``.
    """
    routed: list[str] = []
    ignored: list[str] = []
    have_workspace = False
    have_package = False
    for raw in paths:
        p = Path(raw)
        if p.is_dir():
            if have_workspace:
                ignored.append(f"{raw} (only one workspace folder can be opened)")
                continue
            routed += ["--workspace", raw]
            have_workspace = True
        elif p.is_file() and p.suffix.lower() == ".json":
            routed += ["--import-ontology", raw]
        elif p.is_file() and p.suffix.lower() == ".zip":
            if have_package:
                ignored.append(f"{raw} (only one work package can be opened at once)")
                continue
            routed += ["--package", raw]
            have_package = True
        elif p.exists():
            ignored.append(
                f"{raw} (unsupported file type; expected .zip, .json or a folder)"
            )
        else:
            ignored.append(f"{raw} (no such file, folder or command)")
    return routed, ignored


def main() -> None:
    """CLI script entrypoint with safe argument interpretation."""
    prog = sys.argv[0]
    # macOS Finder may append a process serial number argument.
    args = [a for a in sys.argv[1:] if not a.startswith("-psn_")]

    if not args:
        args = ["serve"]
    elif args[0] not in PASSTHROUGH_FIRST_ARGS:
        split = next((i for i, a in enumerate(args) if a.startswith("-")), len(args))
        routed, ignored = route_positional_args(args[:split])
        if ignored:
            typer.echo(
                "Warning: Ignored argument(s):\n"
                + "\n".join(f"  - {msg}" for msg in ignored)
                + "\nStarting normally. Run 'ontocurator --help' for usage.",
                err=True,
            )
        args = ["serve", *routed, *args[split:]]

    sys.argv = [prog, *args]
    app()


if __name__ == "__main__":
    main()
