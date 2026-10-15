"""Argon2id password hashing, the supplied-hash policy and the password rules.

The parameters are the OWASP minimum for Argon2id (T2 index D-i). A hash
supplied from outside (the bootstrap admin) must be at least as strong.
"""

from __future__ import annotations

import contextlib
import functools
import re

from argon2 import PasswordHasher, Type
from argon2.exceptions import VerifyMismatchError

MEMORY_COST = 19_456  # KiB
TIME_COST = 2
PARALLELISM = 1
MIN_LENGTH = 12
MAX_LENGTH = 256

_HASHER = PasswordHasher(
    time_cost=TIME_COST,
    memory_cost=MEMORY_COST,
    parallelism=PARALLELISM,
    type=Type.ID,
)
_PHC = re.compile(
    r"^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)"
    r"\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$"
)


class PasswordRuleError(ValueError):
    """A password or a supplied hash that the rules do not accept."""


def check_password_rules(username: str, password: str) -> None:
    """Refuse a password that is too short, too long or equal to the username."""
    if len(password) < MIN_LENGTH:
        raise PasswordRuleError(
            f"The password must have at least {MIN_LENGTH} characters."
        )
    if len(password) > MAX_LENGTH:
        raise PasswordRuleError(
            f"The password must have at most {MAX_LENGTH} characters."
        )
    if password.strip().casefold() == username.strip().casefold():
        raise PasswordRuleError("The password must differ from the username.")


def hash_password(password: str) -> str:
    """An Argon2id PHC string of ``password`` with our parameters."""
    return _HASHER.hash(password)


@functools.cache
def _dummy_hash() -> str:
    return _HASHER.hash("ontocurator timing equaliser")


def verify_password(stored_hash: str | None, password: str) -> bool:
    """Whether ``password`` matches ``stored_hash``; never raises.

    Argon2 runs once in every case: an unknown user (``None``) or an unusable
    hash is checked against a dummy hash, so the answer takes as long as for
    a real account (T2 index D-j).
    """
    if stored_hash is not None:
        try:
            return _HASHER.verify(stored_hash, password)
        except VerifyMismatchError:
            return False
        except Exception:  # a broken hash or an unencodable password
            pass
    # The expected mismatch, or anything else: the answer is False either way.
    with contextlib.suppress(Exception):
        _HASHER.verify(_dummy_hash(), password)
    return False


def needs_rehash(stored_hash: str) -> bool:
    """Whether ``stored_hash`` uses other parameters than ours (or is unusable)."""
    try:
        return _HASHER.check_needs_rehash(stored_hash)
    except Exception:
        return True


def assert_policy(stored_hash: str) -> None:
    """Refuse a supplied hash that is not Argon2id at least as strong as ours."""
    match = _PHC.match(stored_hash)
    if match is None:
        raise PasswordRuleError(
            "The password hash must be an Argon2id (v=19) PHC string."
        )
    memory, time, parallelism = (int(group) for group in match.groups())
    if memory < MEMORY_COST or time < TIME_COST or parallelism < PARALLELISM:
        raise PasswordRuleError(
            "The Argon2id parameters must be at least"
            f" m={MEMORY_COST}, t={TIME_COST}, p={PARALLELISM}."
        )
