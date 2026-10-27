"""Prepare identity files, then seed ONE fresh, already-running local T5 stack.

Host-only Python standard library. Never starts, stops, resets or builds a stack.
Use prepare --help / seed --help. Final reviewed source/image and root runtime
validation are prerequisites; preparing files is not evidence of a running demo.
"""

from __future__ import annotations

import argparse
import hashlib
import http.cookiejar
import json
import os
import re
import secrets
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import (
    HTTPCookieProcessor,
    HTTPRedirectHandler,
    ProxyHandler,
    Request,
    build_opener,
)

ROOT = Path(__file__).resolve().parents[1]
INPUTS = ROOT / "examples" / "t5-acceptance"
PROJECT_KEY = "t5-acceptance"
ACTORS = {
    "demo-lead": ("Project lead", "lead", ["en", "de"], None),
    "demo-reviewer": (
        "Translation reviewer",
        "annotator",
        ["en", "de"],
        "Synthetic bilingual review example",
    ),
    "demo-annotator": ("Annotator", "annotator", ["de"], None),
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def configuration(
    *,
    project: str,
    image: str,
    source_sha: str,
    app_port: int,
    pg_port: int,
    snapshot_sha256: str | None = None,
) -> dict[str, Any]:
    if not re.fullmatch(r"ontotator-t5-acceptance(?:-[a-z0-9][a-z0-9-]*)?", project):
        raise ValueError("Use a dedicated ontotator-t5-acceptance[-suffix] project")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
        raise ValueError("An immutable local sha256 image ID is required")
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise ValueError("The final image's full source revision is required")
    if snapshot_sha256 is not None and not re.fullmatch(
        r"[0-9a-f]{64}", snapshot_sha256
    ):
        raise ValueError("The source snapshot must be an exact SHA-256 digest")
    if (
        any(not 1024 <= port <= 65535 for port in (app_port, pg_port))
        or app_port == pg_port
    ):
        raise ValueError("Use distinct unprivileged app and PostgreSQL ports")
    result = dict(
        project=project,
        image=image,
        source_sha=source_sha,
        app_port=app_port,
        pg_port=pg_port,
        host=f"http://127.0.0.1:{app_port}",
    )
    if snapshot_sha256 is not None:
        result["snapshot_sha256"] = snapshot_sha256
    return result


def source_tree_manifest(root: Path = ROOT) -> list[tuple[str, str | None]]:
    """Hash tracked and unignored source bytes, including uncommitted changes.

    Runtime directories/secrets excluded by Git stay outside this identity. Full
    candidate inputs have their own manifest pin. No file contents are printed.
    """
    result = subprocess.run(
        ["git", "ls-files", "-c", "-o", "--exclude-standard", "-z"],
        cwd=root,
        capture_output=True,
        check=True,
    )
    rows = []
    for name in sorted(set(result.stdout.decode("utf-8").split("\0")) - {""}):
        path = root / name
        if not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("Source snapshot cannot follow links outside the checkout")
        rows.append((name, digest(path) if path.is_file() else None))
    return rows


def source_tree_digest(root: Path = ROOT) -> str:
    return hashlib.sha256(
        json.dumps(
            source_tree_manifest(root), ensure_ascii=False, separators=(",", ":")
        ).encode()
    ).hexdigest()


def require_image_identity(cfg: dict[str, Any], image: dict[str, Any]) -> None:
    labels = image["Config"].get("Labels") or {}
    if labels.get("org.opencontainers.image.revision") != cfg["source_sha"]:
        raise ValueError("Frozen image revision label differs from supplied source")
    if (
        cfg.get("snapshot_sha256")
        and labels.get("org.opencontainers.image.source-snapshot-sha256")
        != cfg["snapshot_sha256"]
    ):
        raise ValueError(
            "Frozen image source snapshot differs from the prepared candidate"
        )


def output_path(root: Path, output: Path, *, existing: bool = False) -> Path:
    allowed = (root / "build" / "t5-acceptance").resolve()
    resolved = output.resolve()
    if (
        not allowed.is_relative_to(root.resolve())
        or resolved == allowed
        or not resolved.is_relative_to(allowed)
    ):
        raise ValueError(
            "Output must be inside this checkout's ignored build/t5-acceptance/<run>"
        )
    if not existing and resolved.exists():
        raise ValueError("Output exists; refuse overwrite or reseed")
    if existing and not resolved.is_dir():
        raise ValueError("Prepared output directory does not exist")
    return resolved


def write_private(path: Path, value: Any) -> None:
    # Exclusive creation prevents overwriting credentials, failure markers or runs.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def compose_environment(cfg: dict[str, Any], directory: Path) -> dict[str, str]:
    return {
        "ONTOTATOR_DEV_PORT": str(cfg["app_port"]),
        "ONTOTATOR_DEV_PG_PORT": str(cfg["pg_port"]),
        "ONTOTATOR_MIGRATE_TARGET": "head",
        "GITHUB_TOKEN_FILE": str(directory / "unused-build-token"),
    }


def require_fresh(users: str, projects: str, ontologies: str) -> None:
    rows = [line.split("\t") for line in users.splitlines() if line.strip()]
    if (
        len(rows) != 1
        or len(rows[0]) != 4
        or rows[0][0] != "admin"
        or rows[0][3] != "active, admin"
        or projects.strip()
        or ontologies.strip()
    ):
        raise ValueError(
            "A fresh development stack with only its bootstrap admin is required; never reseed"
        )


def require_service_identity(cfg: dict[str, Any], services: dict[str, Any]) -> None:
    for name in ("app", "migrate", "postgres"):
        item = services[name]
        labels = item["Config"].get("Labels") or {}
        if (
            labels.get("com.docker.compose.project") != cfg["project"]
            or labels.get("com.docker.compose.service") != name
        ):
            raise ValueError("Running service has a different Compose project/service")
        if name in ("app", "migrate") and item["Image"] != cfg["image"]:
            raise ValueError("Running app/migrate image differs from the frozen image")
        state = item["State"]
        if name == "migrate":
            if state.get("Status") != "exited" or state.get("ExitCode") != 0:
                raise ValueError("The actual migration did not finish successfully")
        elif (
            state.get("Status") != "running"
            or state.get("Health", {}).get("Status") != "healthy"
        ):
            raise ValueError("App and PostgreSQL must be healthy before seed")


def checked(
    command: list[str], *, env: dict[str, str], data: bytes | None = None
) -> str:
    result = subprocess.run(
        command, cwd=ROOT, env=env, input=data, capture_output=True, timeout=180
    )
    if result.returncode:
        raise RuntimeError(
            "Command failed; output withheld because setup codes may be present"
        )
    return result.stdout.decode("utf-8")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(
        self, req: Request, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> None:
        return None


class Api:
    def __init__(self, host: str):
        self.host = host
        self.csrf: str | None = None
        self.opener = build_opener(
            HTTPCookieProcessor(http.cookiejar.CookieJar()),
            NoRedirect(),
            ProxyHandler({}),
        )

    def request(self, method: str, path: str, body: Any = None) -> Any:
        if not path.startswith("/api/v1/") or "?" in path or "#" in path:
            raise ValueError("Only fixed same-origin API paths are supported")
        headers = {"Origin": self.host, "Content-Type": "application/json"}
        if self.csrf:
            headers["X-CSRF-Token"] = self.csrf
        request = Request(
            self.host + path,
            method=method,
            headers=headers,
            data=None if body is None else json.dumps(body).encode(),
        )
        try:
            with self.opener.open(request, timeout=30) as response:
                data = response.read()
        except (HTTPError, URLError) as error:
            status = error.code if isinstance(error, HTTPError) else "connection"
            raise RuntimeError(
                f"Acceptance API failed ({status}); response withheld"
            ) from None
        return json.loads(data) if data else None


def verify_inputs(inputs: Path = INPUTS) -> dict[str, Any]:
    manifest: dict[str, Any] = json.loads(
        (inputs / "manifest.json").read_text(encoding="utf-8")
    )
    required = {"hp.json", "profile.json", "demo.zip", "cases.json"}
    translations = manifest.get("translations", [])
    if manifest.get("input_kind") == "full-hpo/v1":
        if (
            not isinstance(translations, list)
            or not translations
            or any(
                not isinstance(name, str)
                or not re.fullmatch(r"hp-[a-z]{2}\.(babelon|synonyms)\.tsv", name)
                for name in translations
            )
            or len(set(translations)) != len(translations)
        ):
            raise ValueError("Full HPO input manifest has invalid translations")
        required |= set(translations)
    elif translations:
        raise ValueError("Public four-file input manifest cannot include translations")
    if set(manifest["sha256"]) != required:
        raise ValueError("Public acceptance input manifest is incomplete")
    for name, expected in manifest["sha256"].items():
        if (
            not re.fullmatch(r"[0-9a-f]{64}", expected)
            or digest(inputs / name) != expected
        ):
            raise ValueError("Public acceptance input hash mismatch")
    return manifest


def prepare(cfg: dict[str, Any], directory: Path, inputs: Path = INPUTS) -> None:
    inputs = inputs.resolve()
    verify_inputs(inputs)
    directory = output_path(ROOT, directory)
    if cfg.get("snapshot_sha256"):
        if source_tree_digest() != cfg["snapshot_sha256"]:
            raise ValueError(
                "Source snapshot changed; freeze the exact candidate again"
            )
        if (
            checked(["git", "rev-parse", "HEAD"], env=dict(os.environ)).strip()
            != cfg["source_sha"]
        ):
            raise ValueError("Candidate base revision differs from the checkout")
    elif checked(["git", "status", "--porcelain"], env=dict(os.environ)).strip():
        raise ValueError("Freeze a clean seed source before preparation")
    directory.mkdir(parents=True)
    if cfg.get("snapshot_sha256"):
        write_private(
            directory / "source-snapshot.json",
            {"sha256": cfg["snapshot_sha256"], "files": source_tree_manifest()},
        )
    token = directory / "unused-build-token"
    token.touch(mode=0o600)
    override = directory / "image.override.json"
    write_private(
        override,
        {"services": {name: {"image": cfg["image"]} for name in ("app", "migrate")}},
    )
    environment = compose_environment(cfg, directory)
    # JSON quotes are supported by Compose dotenv; protects spaces/backslashes.
    (directory / "compose.env").write_text(
        "".join(f"{key}={json.dumps(value)}\n" for key, value in environment.items()),
        encoding="utf-8",
    )
    record = cfg | dict(
        directory=str(directory),
        base_compose=str(ROOT / "docker-compose.dev.yml"),
        override=str(override),
        env_file=str(directory / "compose.env"),
        environment=environment,
        base_sha256=digest(ROOT / "docker-compose.dev.yml"),
        seed_sha256=digest(Path(__file__)),
        inputs=str(inputs),
        manifest_sha256=digest(inputs / "manifest.json"),
        seed_source=checked(["git", "rev-parse", "HEAD"], env=dict(os.environ)).strip(),
    )
    write_private(directory / "identity.json", record)
    stack = Stack(record)
    write_private(
        directory / "commands.json",
        {
            "start": [*stack.command, "up", "-d", "--no-build", "--wait"],
            "status": [*stack.command, "ps", "--all"],
            "stop": [*stack.command, "stop"],
            "restart": [*stack.command, "up", "-d", "--no-build", "--wait"],
            "logs": [*stack.command, "logs", "--tail", "100", "app"],
            "host": cfg["host"],
            "environment": environment,
        },
    )


class Stack:
    def __init__(self, cfg: dict[str, Any]):
        self.cfg = cfg
        self.env = dict(os.environ) | cfg["environment"]
        self.command = [
            "docker",
            "compose",
            "--project-name",
            cfg["project"],
            "--env-file",
            cfg["env_file"],
            "-f",
            cfg["base_compose"],
            "-f",
            cfg["override"],
        ]

    def compose(self, *args: str, data: bytes | None = None) -> str:
        return checked(self.command + list(args), env=self.env, data=data)

    def cli(self, *args: str) -> str:
        return self.compose("exec", "-T", "app", "ontotator", "admin", *args)

    def verify(self) -> dict[str, Any]:
        cfg = self.cfg
        services = {}
        for name in ("app", "migrate", "postgres"):
            ids = self.compose("ps", "--all", "--quiet", name).split()
            if len(ids) != 1:
                raise ValueError(
                    "Expected exactly one container per acceptance service"
                )
            services[name] = json.loads(
                checked(["docker", "inspect", ids[0]], env=self.env)
            )[0]
        require_service_identity(cfg, services)
        for item in services.values():
            labels = item["Config"]["Labels"]
            actual_files = [
                Path(path).resolve()
                for path in labels.get(
                    "com.docker.compose.project.config_files", ""
                ).split(",")
            ]
            expected_files = [
                Path(cfg["base_compose"]).resolve(),
                Path(cfg["override"]).resolve(),
            ]
            if (
                actual_files != expected_files
                or Path(
                    labels.get("com.docker.compose.project.working_dir", "")
                ).resolve()
                != ROOT
            ):
                raise ValueError(
                    "Running Compose source files/working directory differ from prepared identity"
                )
        image = json.loads(
            checked(["docker", "image", "inspect", cfg["image"]], env=self.env)
        )[0]
        require_image_identity(cfg, image)
        mounts = {}
        for name, port, target, destination in [
            ("app", cfg["app_port"], "8000/tcp", "/data"),
            ("postgres", cfg["pg_port"], "5432/tcp", "/var/lib/postgresql/data"),
        ]:
            item = services[name]
            bindings = item["HostConfig"]["PortBindings"].get(target)
            if bindings != [{"HostIp": "127.0.0.1", "HostPort": str(port)}]:
                raise ValueError("Acceptance ports must match exact loopback identity")
            volumes = [
                m
                for m in item["Mounts"]
                if m["Destination"] == destination and m["Type"] == "volume"
            ]
            if len(volumes) != 1:
                raise ValueError(
                    "Persistent database and app data volumes are required"
                )
            volume = json.loads(
                checked(
                    ["docker", "volume", "inspect", volumes[0]["Name"]], env=self.env
                )
            )[0]
            if (volume.get("Labels") or {}).get("com.docker.compose.project") != cfg[
                "project"
            ]:
                raise ValueError("Volume belongs to another Compose project")
            mounts[name] = volumes[0]["Name"]
        if (
            f"ONTOTATOR_PUBLIC_ORIGIN={cfg['host']}"
            not in services["app"]["Config"]["Env"]
        ):
            raise ValueError("App public origin differs from actual acceptance origin")
        return {
            "container_ids": {name: item["Id"] for name, item in services.items()},
            "volumes": mounts,
        }


def load_prepared(directory: Path) -> dict[str, Any]:
    directory = output_path(ROOT, directory, existing=True)
    cfg: dict[str, Any] = json.loads(
        (directory / "identity.json").read_text(encoding="utf-8")
    )
    configuration(
        **{
            key: cfg[key]
            for key in ("project", "image", "source_sha", "app_port", "pg_port")
        },
        snapshot_sha256=cfg.get("snapshot_sha256"),
    )
    inputs = Path(cfg.get("inputs", INPUTS)).resolve()
    if cfg.get("snapshot_sha256") and source_tree_digest() != cfg["snapshot_sha256"]:
        raise ValueError("Prepared source snapshot changed; prepare a fresh candidate")
    if (
        cfg["directory"] != str(directory)
        or cfg["host"] != f"http://127.0.0.1:{cfg['app_port']}"
    ):
        raise ValueError("Prepared directory/origin identity changed")
    if (
        cfg["base_compose"] != str(ROOT / "docker-compose.dev.yml")
        or cfg["override"] != str(directory / "image.override.json")
        or cfg["env_file"] != str(directory / "compose.env")
    ):
        raise ValueError("Prepared Compose identity changed")
    if (
        cfg["base_sha256"] != digest(ROOT / "docker-compose.dev.yml")
        or cfg["seed_sha256"] != digest(Path(__file__))
        or cfg["manifest_sha256"] != digest(inputs / "manifest.json")
    ):
        raise ValueError(
            "Prepared source/input identities changed; prepare a fresh run"
        )
    verify_inputs(inputs)
    expected = {
        "services": {name: {"image": cfg["image"]} for name in ("app", "migrate")}
    }
    if json.loads(Path(cfg["override"]).read_text(encoding="utf-8")) != expected:
        raise ValueError("Prepared image override changed")
    environment = compose_environment(cfg, directory)
    expected_env = "".join(
        f"{key}={json.dumps(value)}\n" for key, value in environment.items()
    )
    if (
        cfg["environment"] != environment
        or Path(cfg["env_file"]).read_text(encoding="utf-8") != expected_env
    ):
        raise ValueError("Prepared Compose environment changed")
    return cfg


def assign(api: Api, document: str, username: str, task: str) -> dict[str, Any]:
    result = api.request(
        "POST",
        f"/api/v1/projects/{PROJECT_KEY}/assignments",
        {
            "rows": [{"document_id": document, "username": username}],
            "task": task,
        },
    )
    if result["refused"] or len(result["created"]) != 1:
        raise RuntimeError(
            "Real assignment refused; no privilege or language bypass applied"
        )
    created: dict[str, Any] = result["created"][0]
    return created


# ontospan.default_axes(); mirrored because this script is host-only stdlib.
CLINICAL_DEFAULTS = {
    "assertion": "present",
    "experiencer": "patient",
    "temporality": "current",
}


def clinical_creation_defaults(
    profile: dict[str, Any], hidden: dict[str, Any]
) -> dict[str, dict[str, dict[str, str]]]:
    """The server's creation-default rule (U5) on a JSON task profile."""
    result: dict[str, dict[str, dict[str, str]]] = {}
    for layer in profile["layers"]:
        if layer["access"] != "editable":
            continue
        hidden_here = hidden.get(layer["layer_id"], {})
        for kind in layer["annotation_types"]:
            preset = {
                axis["id"]: CLINICAL_DEFAULTS[axis["id"]]
                for axis in kind["axes"]
                if CLINICAL_DEFAULTS.get(axis["id"]) in axis["options"]
                and CLINICAL_DEFAULTS[axis["id"]] not in hidden_here.get(axis["id"], [])
            }
            if preset:
                result.setdefault(layer["layer_id"], {})[kind["type_id"]] = preset
    return result


def ensure_creation_defaults(api: Any) -> bool:
    """Set the clinical creation defaults through the settings API; skip when equal."""
    path = f"/api/v1/projects/{PROJECT_KEY}/settings"
    settings = api.request("GET", path)
    wanted = clinical_creation_defaults(
        settings["profile"], settings.get("hidden_axis_values") or {}
    )
    if settings.get("creation_defaults") == wanted:
        return False
    changed = api.request("PATCH", path, {"creation_defaults": wanted})
    if changed["creation_defaults"] != wanted:
        raise RuntimeError("Creation defaults were not stored as requested")
    return True


def seed(directory: Path) -> None:
    cfg = load_prepared(directory)
    directory = Path(cfg["directory"])
    inputs = Path(cfg.get("inputs", INPUTS))
    if any(
        (directory / name).exists()
        for name in ("seed-started.json", "credentials.json", "seed-result.json")
    ):
        raise ValueError("Seed was already attempted; ordinary restart needs no reseed")
    stack = Stack(cfg)
    identity = stack.verify()
    require_fresh(
        stack.cli("users", "list"),
        stack.cli("projects", "list"),
        stack.cli("ontologies", "list"),
    )
    # Readiness is checked before any writes, with no authenticated cookies yet.
    try:
        with build_opener(NoRedirect(), ProxyHandler({})).open(
            cfg["host"] + "/readyz", timeout=15
        ) as response:
            if response.status != 200:
                raise RuntimeError("Acceptance app is not ready")
    except (HTTPError, URLError):
        raise RuntimeError("Acceptance app is not ready") from None
    write_private(
        directory / "seed-started.json",
        {"started_utc": datetime.now(UTC).isoformat(), "identity": identity},
    )
    passwords = {username: secrets.token_urlsafe(24) for username in ACTORS}
    write_private(
        directory / "credentials.json",
        {
            "host": cfg["host"],
            "accounts": [
                {"username": username, "password": passwords[username], "role": data[1]}
                for username, data in ACTORS.items()
            ],
        },
    )
    for name in ("hp.json", "profile.json", "demo.zip"):
        stack.compose(
            "exec",
            "-T",
            "app",
            "python",
            "-c",
            "import pathlib,sys; pathlib.Path(sys.argv[1]).write_bytes(sys.stdin.buffer.read())",
            f"/tmp/t5-acceptance-{name}",
            data=(inputs / name).read_bytes(),
        )
    manifest = verify_inputs(inputs)
    stack.cli("ontologies", "add", "/tmp/t5-acceptance-hp.json")
    for name in manifest.get("translations", []):
        destination = f"/tmp/{name}"
        stack.compose(
            "exec",
            "-T",
            "app",
            "python",
            "-c",
            "import pathlib,sys; pathlib.Path(sys.argv[1]).write_bytes(sys.stdin.buffer.read())",
            destination,
            data=(inputs / name).read_bytes(),
        )
        stack.cli("ontologies", "add", destination)
    stack.cli(
        "projects",
        "create",
        PROJECT_KEY,
        "--name",
        "T5 synthetic acceptance",
        "--profile",
        "/tmp/t5-acceptance-profile.json",
        "--pin",
        f"hp={manifest['sha256']['hp.json']}",
        "--allowed-roots",
        "hp=HP:0000118",
        "--t1-profile",
        "hp=hpo-phenotype",
    )
    actors = {}
    for username, (display, role, languages, qualification) in ACTORS.items():
        output = stack.cli("users", "create", username, "--display-name", display)
        codes = re.findall(r"(?m)^  ([A-Za-z0-9_-]{20,})\s*$", output)
        if len(codes) != 1:
            raise RuntimeError("Could not consume synthetic account setup code")
        stack.cli("projects", "add-member", PROJECT_KEY, username, "--role", role)
        api = Api(cfg["host"])
        current = api.request(
            "POST",
            "/api/v1/auth/redeem-code",
            {
                "username": username,
                "code": codes[0],
                "new_password": passwords[username],
            },
        )
        if current["is_system_admin"]:
            raise RuntimeError(
                "Demo work account unexpectedly has administrator rights"
            )
        api.csrf = current["csrf_token"]
        profile = api.request(
            "PATCH",
            "/api/v1/me/profile",
            {"languages": languages, "qualification": qualification},
        )
        if (
            set(profile["languages"]) != set(languages)
            or profile["qualification"] != qualification
        ):
            raise RuntimeError(
                "Actual reading languages/qualification differ from requested profile"
            )
        current = api.request(
            "POST",
            "/api/v1/auth/login",
            {"username": username, "password": passwords[username]},
        )
        api.csrf = current["csrf_token"]
        actors[username] = api
    lead = actors["demo-lead"]
    lead.request(
        "PATCH", f"/api/v1/projects/{PROJECT_KEY}/settings", {"languages": ["en", "de"]}
    )
    ensure_creation_defaults(lead)
    stack.cli("import", PROJECT_KEY, "/tmp/t5-acceptance-demo.zip")
    documents = lead.request("GET", f"/api/v1/projects/{PROJECT_KEY}/documents")
    if len(documents) != 6:
        raise RuntimeError("Real import did not produce the six expected variants")
    cases = json.loads((inputs / "cases.json").read_text(encoding="utf-8"))
    by_external = {
        (row["external_id"], row["language"]): row["document_id"] for row in documents
    }
    metadata = {(row["external_id"], row["language"]): row for row in documents}
    assigned = {}
    for name, case in cases.items():
        document = by_external[(case["target_external_id"], "de")]
        target = metadata[(case["target_external_id"], "de")]
        expected_status = (
            "ready_for_review" if case["checks_passed"] else "automatic_check_failed"
        )
        if (
            target["origin"] != "machine_translation"
            or target["translation_status"] != expected_status
        ):
            raise RuntimeError(
                "Imported translation/check state differs from public input contract"
            )
        assigned[name] = assign(lead, document, "demo-reviewer", "translation_review")
    accepted = assigned["accepted"]
    reviewer = actors["demo-reviewer"]
    base = f"/api/v1/translation-reviews/{accepted['id']}"
    workspace = reviewer.request("GET", base)
    revision = reviewer.request(
        "PUT",
        base + "/draft",
        {
            "expected_revision": workspace["draft"]["revision"],
            "text": workspace["text"],
            "form": {"decision": "accepted_unchanged", "clinical_change": False},
        },
    )["revision"]
    record = reviewer.request("POST", base + "/submit", {"expected_revision": revision})
    if record["status_after"] != "accepted" or record["created_variant_id"] is not None:
        raise RuntimeError("Real review did not accept the independent annotation case")
    annotation = assign(lead, accepted["document_id"], "demo-annotator", "annotate")
    tasks = reviewer.request("GET", "/api/v1/me/tasks")
    statuses = {row["assignment_id"]: row["status"] for row in tasks}
    if (
        any(
            statuses.get(assigned[name]["id"]) != "open" for name in ("ready", "failed")
        )
        or statuses.get(accepted["id"]) != "submitted"
    ):
        raise RuntimeError("User-facing review tasks are not fresh and open")
    annotation_tasks = actors["demo-annotator"].request("GET", "/api/v1/me/tasks")
    if (
        len(annotation_tasks) != 1
        or annotation_tasks[0]["assignment_id"] != annotation["id"]
        or annotation_tasks[0]["status"] != "open"
    ):
        raise RuntimeError("The annotator's real accepted-text assignment is not open")
    members = lead.request("GET", f"/api/v1/projects/{PROJECT_KEY}/members")
    if {row["username"]: row["roles"] for row in members} != {
        name: [data[1]] for name, data in ACTORS.items()
    }:
        raise RuntimeError("Actual demo roles differ from the minimum-role contract")
    write_private(
        directory / "seed-result.json",
        {
            "completed_utc": datetime.now(UTC).isoformat(),
            "identity": identity,
            "source_sha": cfg["source_sha"],
            "image": cfg["image"],
            "manifest_sha256": cfg["manifest_sha256"],
            "project_key": PROJECT_KEY,
            "review_assignments": {name: row["id"] for name, row in assigned.items()},
            "annotation_assignment_id": annotation["id"],
            "review_record_id": record["id"],
            "document_ids": [row["document_id"] for row in documents],
            "pending_user_reviews": [
                assigned[name]["id"] for name in ("ready", "failed")
            ],
            "correction_pending_journey": "not preseeded; final packaged validation required",
        },
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    setup = commands.add_parser(
        "prepare", help="Write ignored identity/startup files only"
    )
    setup.add_argument("--project", required=True)
    setup.add_argument(
        "--image",
        required=True,
        help="Final local sha256 image ID, never a mutable tag",
    )
    setup.add_argument(
        "--source-sha",
        required=True,
        help="Full revision matching the image's OCI revision label",
    )
    setup.add_argument("--app-port", required=True, type=int)
    setup.add_argument("--pg-port", required=True, type=int)
    setup.add_argument("--inputs-dir", type=Path, default=INPUTS)
    setup.add_argument(
        "--snapshot-sha256",
        help="Explicit dirty source identity; requires matching OCI source-snapshot-sha256 image label",
    )
    for command in (
        setup,
        commands.add_parser(
            "seed", help="Seed one fresh already-running verified stack"
        ),
    ):
        command.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.operation == "prepare":
            prepare(
                configuration(
                    project=args.project,
                    image=args.image,
                    source_sha=args.source_sha,
                    app_port=args.app_port,
                    pg_port=args.pg_port,
                    snapshot_sha256=args.snapshot_sha256,
                ),
                args.output_dir,
                args.inputs_dir,
            )
        else:
            seed(args.output_dir)
    except (ValueError, RuntimeError) as error:
        print(f"Acceptance operation refused or incomplete: {error}", file=sys.stderr)
        return 1
    except (OSError, KeyError):
        print(
            "Acceptance preparation/seed refused or incomplete; private diagnostics withheld. Inspect the recorded identity and fresh-stack preconditions. Never retry a partial seed on populated data.",
            file=sys.stderr,
        )
        return 1
    print(
        "Acceptance source operation finished. Local identity/result files determine what was prepared or seeded; no runtime acceptance is implied."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
