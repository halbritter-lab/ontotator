"""Command line entry point for Ontocurator."""

from __future__ import annotations

import contextlib
import ipaddress
import json
import os
import stat
import sys
import tempfile
from collections.abc import Iterator
from datetime import UTC
from importlib import metadata
from pathlib import Path
from typing import Annotated, Any, NoReturn
from urllib.parse import urlsplit

import typer
import uvicorn

from ontocurator.api.app import create_app
from ontocurator.auth.accounts import AccountService, IssuedCode, User
from ontocurator.auth.audit import Actor
from ontocurator.config import AppConfig
from ontocurator.domain.errors import DomainError
from ontocurator.storage.database import Database

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


admin_app = typer.Typer(
    help="Users, password hashes and the offline admin recovery.",
    no_args_is_help=True,
)
users_app = typer.Typer(help="Users and their single-use codes.", no_args_is_help=True)
app.add_typer(admin_app, name="admin")
admin_app.add_typer(users_app, name="users")

RECOVERY_INPUT_MAX_BYTES = 8 * 1024
RECOVERY_KEYS = ("username", "password_hash", "operator", "reason")


def _fail(code: str, details: object) -> NoReturn:
    typer.echo(f"Error: {code}: {details}", err=True)
    raise typer.Exit(code=1)


@admin_app.callback()
def admin_callback(
    ctx: typer.Context,
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
) -> None:
    """Manage users and recover a lost admin password, on the database directly."""
    ctx.obj = {"database_url": database_url}


@contextlib.contextmanager
def _open_database(ctx: typer.Context) -> Iterator[Database]:
    """The database of ``--database-url``, closed again on every exit.

    A ``DomainError`` of the body becomes ``Error: <CODE>: <details>`` and
    exit 1.
    """
    from sqlalchemy.exc import OperationalError

    from ontocurator import settings
    from ontocurator.storage.schema import current_revision, head_revision

    explicit = (ctx.obj or {}).get("database_url")
    try:
        url = settings.resolve_database_url(explicit, None)
    except settings.SettingsError as exc:
        _fail("SETTINGS_INVALID", exc)
    data_dir = Path(os.environ.get("ONTOCURATOR_DATA_DIR") or "data")
    db = Database(url, data_dir=data_dir, pool_size=2, max_overflow=2)
    try:
        try:
            with db.transaction() as conn:
                current = current_revision(conn)
        except OperationalError as exc:
            reason = " ".join(str(exc.orig).split())
            _fail("DATABASE_UNAVAILABLE", f"Cannot use the database: {reason}")
        head = head_revision()
        if current != head:
            _fail(
                "DATABASE_NOT_MIGRATED",
                f"The database schema is at revision {current or 'none'}, this "
                f"version needs {head}. Run 'ontocurator db upgrade' with the "
                "schema owner's credentials first.",
            )
        try:
            yield db
        except DomainError as exc:
            _fail(exc.code, exc.details)
    finally:
        db.close()


def _print_code(issued: IssuedCode) -> None:
    until = issued.expires_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M")
    typer.echo(
        f"{issued.purpose.capitalize()} code for '{issued.user.username}' "
        f"(single use, valid until {until} UTC):"
    )
    typer.echo(f"  {issued.code}")
    typer.echo("Hand it to the user out of band. It is not shown again.")


def _print_flags(user: User) -> None:
    def yes_no(value: bool) -> str:
        return "yes" if value else "no"

    typer.echo(
        f"'{user.username}': active={yes_no(user.active)}, "
        f"system admin={yes_no(user.is_system_admin)}."
    )


UsernameArgument = Annotated[str, typer.Argument(help="The user's login name.")]


@users_app.command("create")
def users_create(
    ctx: typer.Context,
    username: Annotated[
        str,
        typer.Argument(
            help="Login name: 3 to 64 of a-z 0-9 . _ - (stored in lower case)."
        ),
    ],
    display_name: Annotated[
        str, typer.Option("--display-name", help="The name other people see.")
    ],
    email: Annotated[
        str | None, typer.Option("--email", help="Optional contact address.")
    ] = None,
    system_admin: Annotated[
        bool,
        typer.Option("--system-admin", help="Make the user a system administrator."),
    ] = False,
    pseudonym: Annotated[
        str | None,
        typer.Option(
            "--pseudonym",
            help="Annotator pseudonym. Default: the next free ann-NNNN.",
            show_default=False,
        ),
    ] = None,
) -> None:
    """Create a user and print its single-use setup code (valid 24 hours)."""
    with _open_database(ctx) as db:
        issued = AccountService(db).create_user(
            Actor.cli(),
            username,
            display_name,
            email=email,
            system_admin=system_admin,
            pseudonym=pseudonym,
        )
    typer.echo(
        f"Created user '{issued.user.username}' (pseudonym {issued.user.pseudonym})."
    )
    _print_code(issued)


@users_app.command("reset-code")
def users_reset_code(ctx: typer.Context, username: UsernameArgument) -> None:
    """Print a single-use reset code (valid 15 minutes); older codes end."""
    with _open_database(ctx) as db:
        issued = AccountService(db).issue_reset_code(Actor.cli(), username)
    _print_code(issued)


@users_app.command("deactivate")
def users_deactivate(ctx: typer.Context, username: UsernameArgument) -> None:
    """Deactivate a user; their sessions end."""
    with _open_database(ctx) as db:
        user = AccountService(db).set_active(Actor.cli(), username, False)
    _print_flags(user)


@users_app.command("activate")
def users_activate(ctx: typer.Context, username: UsernameArgument) -> None:
    """Activate a deactivated user again."""
    with _open_database(ctx) as db:
        user = AccountService(db).set_active(Actor.cli(), username, True)
    _print_flags(user)


@users_app.command("set-admin")
def users_set_admin(
    ctx: typer.Context,
    username: UsernameArgument,
    on: Annotated[
        bool,
        typer.Option(
            "--on/--off",
            help="Grant or withdraw the system admin role.",
            show_default=False,
        ),
    ],
) -> None:
    """Grant or withdraw the system admin role; a change ends the user's sessions."""
    with _open_database(ctx) as db:
        user = AccountService(db).set_system_admin(Actor.cli(), username, on)
    _print_flags(user)


@users_app.command("list")
def users_list(ctx: typer.Context) -> None:
    """One line per user: username, pseudonym, display name and state (tabs)."""
    with _open_database(ctx) as db:
        users = AccountService(db).list_users()
    for user in users:
        state = "active" if user.active else "inactive"
        if user.is_system_admin:
            state += ", admin"
        typer.echo(f"{user.username}\t{user.pseudonym}\t{user.display_name}\t{state}")


@admin_app.command("hash-password")
def hash_password_command() -> None:
    """Print the Argon2id hash of a password.

    On a terminal it asks twice; otherwise it reads one line from standard
    input. The hash is meant for ONTOCURATOR_ADMIN_PASSWORD_HASH and the
    recovery file; the password itself is never stored.
    """
    import getpass

    from ontocurator.auth.passwords import (
        PasswordRuleError,
        check_password_rules,
        hash_password,
    )

    if sys.stdin.isatty():
        password = getpass.getpass("Password: ")
        if getpass.getpass("Repeat the password: ") != password:
            _fail("PASSWORD_MISMATCH", "The two entries differ.")
    else:
        line = sys.stdin.readline()
        password = line[:-2] if line.endswith("\r\n") else line.removesuffix("\n")
    try:
        check_password_rules(None, password)
    except PasswordRuleError as exc:
        _fail("PASSWORD_RULES", exc)
    typer.echo(hash_password(password))


def _read_recovery_input(path: Path) -> dict[str, str]:
    """The four fields of a private recovery file; errors never show its content."""
    try:
        info = path.stat()
        if not stat.S_ISREG(info.st_mode):
            _fail("RECOVERY_INPUT_INVALID", f"{path} is not a regular file.")
        if os.name == "posix" and info.st_mode & 0o077:
            _fail(
                "RECOVERY_INPUT_NOT_PRIVATE",
                f"{path} is accessible to other users; make it private first "
                "(chmod 600).",
            )
        if info.st_size > RECOVERY_INPUT_MAX_BYTES:
            _fail("RECOVERY_INPUT_TOO_LARGE", f"{path} is larger than 8 KiB.")
        with path.open("rb") as handle:
            raw = handle.read(RECOVERY_INPUT_MAX_BYTES + 1)
    except OSError as exc:
        _fail("RECOVERY_INPUT_UNREADABLE", f"Cannot read {path}: {exc.strerror}.")
    if len(raw) > RECOVERY_INPUT_MAX_BYTES:
        _fail("RECOVERY_INPUT_TOO_LARGE", f"{path} is larger than 8 KiB.")
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except UnicodeDecodeError:
        _fail("RECOVERY_INPUT_INVALID", f"{path} is not UTF-8 text.")
    except json.JSONDecodeError as exc:
        _fail(
            "RECOVERY_INPUT_INVALID",
            f"{path} is not valid JSON (line {exc.lineno}, column {exc.colno}).",
        )
    if (
        not isinstance(data, dict)
        or set(data) != set(RECOVERY_KEYS)
        or not all(isinstance(value, str) for value in data.values())
    ):
        _fail(
            "RECOVERY_INPUT_INVALID",
            f"{path} must hold one JSON object with exactly the text fields "
            f"{', '.join(RECOVERY_KEYS)}.",
        )
    return {key: data[key] for key in RECOVERY_KEYS}


@admin_app.command("recover-admin")
def recover_admin_command(
    ctx: typer.Context,
    input_file: Annotated[
        Path,
        typer.Option(
            "--input",
            help=(
                "Private JSON file (owner only, at most 8 KiB) with username, "
                "password_hash, operator and reason."
            ),
        ),
    ],
) -> None:
    """Replace a lost admin password while the service is stopped.

    Make the hash with 'ontocurator admin hash-password'; the file never holds
    the password itself. The operator and the reason are audited, and all
    sessions of the admin end.
    """
    from ontocurator.storage.lease import exclusive_lease

    request = _read_recovery_input(input_file)
    with _open_database(ctx) as db, exclusive_lease(db.engine) as alone:
        if not alone:
            _fail(
                "SERVICE_RUNNING",
                "Stop the Ontocurator service first; it is still running.",
            )
        user = AccountService(db).recover_admin(**request)
    typer.echo(f"Recovered '{user.username}'; all of its sessions were ended.")


def main() -> None:
    """Console script entry point."""
    app()


if __name__ == "__main__":
    main()
