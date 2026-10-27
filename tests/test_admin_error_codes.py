"""Administration catalog/export stays tied to actual error-producing source."""

import ast
import json
import re
from pathlib import Path

from ontotator.domain.admin_error_codes import ADMIN_ERROR_CODES

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src" / "ontotator"
# Directories include future modules in these administration surfaces and their
# shared repository/workspace producers. Other services retain server fallback.
PATHS = (
    "api/admin_routes.py",
    "api/me_routes.py",
    "api/project_routes.py",
    "api/ontology_routes.py",
    "api/upload_routes.py",
    "api/job_routes.py",
    "api/assignment_routes.py",
    "api/document_projection.py",
    "api/variant_routes.py",
    "api/translation_review_routes.py",
    "api/translation_workflow_routes.py",
    "api/work_round_routes.py",
    "api/problem_report_routes.py",
    "api/final_result_routes.py",
    "api/submission_history_routes.py",
    "application/translation_workflow.py",
    "application/work_rounds.py",
    "application/problem_reports.py",
    "application/workflow_guards.py",
    "application/final_results.py",
    "domain/work_rounds.py",
    "api/security.py",
    "auth/accounts.py",
    "auth/authority.py",
    "authz",
    "assignments",
    "projects",
    "exchange",
    "ontology/store.py",
    "application/submissions.py",
    "application/text_changes.py",
    "api/text_change_routes.py",
    "application/translation_reviews.py",
    "application/workspaces.py",
    "domain/errors.py",
    "domain/project_rules.py",
    "storage/repository.py",
)


def finite_string_values(node: ast.AST | None) -> set[str]:
    """Resolve only literal strings and conditional branches that are both finite."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return {node.value}
    if isinstance(node, ast.IfExp):
        left = finite_string_values(node.body)
        right = finite_string_values(node.orelse)
        return left | right if left and right else set()
    return set()


def named_string_values(tree: ast.AST) -> dict[str, set[str]]:
    values: dict[str, set[str]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
        else:
            continue
        choices = finite_string_values(node.value)
        if choices:
            for target in targets:
                if isinstance(target, ast.Name):
                    values.setdefault(target.id, set()).update(choices)
    return values


def source_codes(source: str, *, error_defaults: bool = False) -> set[str]:
    """Inspect error constructors, code= diagnostics and code-first helpers.

    Ordinary constants/HTTP verbs/ontology prefixes are not catalog entries.
    Nonliteral error.code forwarding is already produced by its source; static
    named constants are resolved instead of silently losing those call sites.
    """
    tree = ast.parse(source)
    parents = {
        child: parent
        for parent in ast.walk(tree)
        for child in ast.iter_child_nodes(parent)
    }
    constants = named_string_values(tree)
    constructors = {"DomainError", "AccessDenied"}
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.ImportFrom)
            and node.module == "ontotator.domain.errors"
        ):
            constructors.update(
                alias.asname or alias.name
                for alias in node.names
                if alias.name in constructors
            )
    helpers = {
        node.name: next(
            index for index, arg in enumerate(node.args.args) if arg.arg == "code"
        )
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and any(arg.arg == "code" for arg in node.args.args)
    }
    result: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        candidates = [
            keyword.value for keyword in node.keywords if keyword.arg == "code"
        ]
        if node.args and (
            (isinstance(node.func, ast.Name) and node.func.id in constructors)
            or (
                error_defaults
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "__init__"
            )
        ):
            candidates.append(node.args[0])
        if (
            isinstance(node.func, ast.Name)
            and node.func.id in helpers
            and len(node.args) > helpers[node.func.id]
        ):
            candidates.append(node.args[helpers[node.func.id]])
        for candidate in candidates:
            choices = (
                constants.get(candidate.id, set())
                if isinstance(candidate, ast.Name)
                else finite_string_values(candidate)
            )
            if choices:
                result.update(
                    code
                    for code in choices
                    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", code)
                )
            elif isinstance(candidate, ast.JoinedStr):
                result.update(guarded_format_codes(candidate, parents))
    return result


def guarded_format_codes(
    node: ast.JoinedStr, parents: dict[ast.AST, ast.AST]
) -> set[str]:
    """Resolve the real finite obsolete/unknown term branch from its AST guard."""
    values = [""]
    for part in node.values:
        if isinstance(part, ast.Constant) and isinstance(part.value, str):
            choices = {part.value}
        elif (
            isinstance(part, ast.FormattedValue)
            and isinstance(part.value, ast.Call)
            and isinstance(part.value.func, ast.Attribute)
            and part.value.func.attr == "upper"
            and not part.value.args
        ):
            expression = ast.dump(part.value.func.value)
            choices = set()
            child: ast.AST = node
            while child in parents:
                parent = parents[child]
                if (
                    isinstance(parent, ast.If)
                    and child in parent.body
                    and isinstance(parent.test, ast.Compare)
                    and ast.dump(parent.test.left) == expression
                    and len(parent.test.ops) == 1
                    and isinstance(parent.test.ops[0], ast.In)
                    and isinstance(
                        parent.test.comparators[0], (ast.Set, ast.Tuple, ast.List)
                    )
                ):
                    choices = {
                        item.value.upper()
                        for item in parent.test.comparators[0].elts
                        if isinstance(item, ast.Constant)
                        and isinstance(item.value, str)
                    }
                    break
                child = parent
            assert choices, (
                "Dynamic error code needs a finite source guard or an explicit producer witness"
            )
        else:
            raise AssertionError(
                "Dynamic error code needs a finite source guard or an explicit producer witness"
            )
        values = [prefix + choice for prefix in values for choice in choices]
    return set(values)


def actual_codes() -> set[str]:
    paths = {
        file
        for name in PATHS
        for file in (
            (SOURCE / name).rglob("*.py")
            if (SOURCE / name).is_dir()
            else [SOURCE / name]
        )
    }
    # This sole non-finite constructor rethrows codes from normalize_username;
    # that actual producer is included above. New dynamic throws must be audited.
    forwarded = {("assignments/confirmations.py", "invalid_names[row.username]")}
    observed = set()
    for path in paths:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        constants = named_string_values(tree)
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id in {"DomainError", "AccessDenied"}
                and node.args
                and not isinstance(node.args[0], (ast.Constant, ast.JoinedStr))
            ):
                expression = ast.unparse(node.args[0])
                if isinstance(node.args[0], ast.Name) and node.args[0].id in constants:
                    continue
                else:
                    observed.add((path.relative_to(SOURCE).as_posix(), expression))
    assert observed == forwarded, (
        f"Audit changed dynamic error producers: {observed ^ forwarded}"
    )
    return set().union(
        *(
            source_codes(
                path.read_text(encoding="utf-8"),
                error_defaults=path.name == "errors.py",
            )
            for path in paths
        )
    )


def test_catalog_covers_actual_administration_error_producers():
    missing = actual_codes() - set(ADMIN_ERROR_CODES)
    assert not missing, (
        f"Add actual administration error codes to catalog/export/UI: {sorted(missing)}"
    )


def test_export_is_sorted_unique_and_exactly_matches_backend_catalog():
    assert list(ADMIN_ERROR_CODES) == sorted(set(ADMIN_ERROR_CODES))
    exported = json.loads(
        (ROOT / "contracts" / "admin-error-codes.json").read_text(encoding="utf-8")
    )
    assert exported == list(ADMIN_ERROR_CODES)


def test_source_coverage_detects_new_code_without_treating_labels_as_errors():
    assert source_codes(
        'VERB = "POST"\nPREFIX = "HP"\nTASK = "OPEN_TASK"\nraise DomainError("NEW_ADMIN_FAILURE")'
    ) == {"NEW_ADMIN_FAILURE"}
    assert source_codes('CODE = "NEW_NAMED_FAILURE"\nraise AccessDenied(CODE)') == {
        "NEW_NAMED_FAILURE"
    }
    assert source_codes(
        'def issue(code, text): pass\nissue("NEW_UPLOAD_FAILURE", "bad")'
    ) == {"NEW_UPLOAD_FAILURE"}
    assert source_codes('Issue(code="NEW_PLAN_FAILURE")') == {"NEW_PLAN_FAILURE"}
    assert source_codes('CODE: str = "ANNOTATED_FAILURE"\nraise DomainError(CODE)') == {
        "ANNOTATED_FAILURE"
    }
    assert source_codes(
        'if status.status in {"obsolete", "unknown"}:\n raise DomainError(f"{status.status.upper()}_TERM")'
    ) == {"OBSOLETE_TERM", "UNKNOWN_TERM"}


def test_source_coverage_resolves_finite_conditional_codes_without_allowing_forwarding():
    assert source_codes(
        'code = "UNKNOWN_TERM" if missing else "OBSOLETE_TERM"\nraise DomainError(code)'
    ) == {"UNKNOWN_TERM", "OBSOLETE_TERM"}
    assert source_codes(
        'code: str = "FIRST" if condition else "SECOND"\nraise DomainError(code)'
    ) == {"FIRST", "SECOND"}
    # A branch forwarding arbitrary values must still require explicit auditing.
    unresolved = ast.parse('code = "KNOWN" if condition else external_code')
    assert named_string_values(unresolved) == {}
