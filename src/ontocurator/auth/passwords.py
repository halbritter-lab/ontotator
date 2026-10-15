"""Argon2id password hashing, the supplied-hash policy and the password rules.

The parameters are the OWASP minimum for Argon2id (T2 index D-i). A hash
supplied from outside (the bootstrap admin) must be at least as strong, and at
most as costly as the caps below, so one login cannot exhaust the server.

Passwords are compared in Unicode NFC, so a composed and a decomposed spelling
of the same text are the same password.
"""

from __future__ import annotations

import contextlib
import re
import unicodedata

from argon2 import PasswordHasher, Type
from argon2.exceptions import VerifyMismatchError

MEMORY_COST = 19_456  # KiB
TIME_COST = 2
PARALLELISM = 1
MAX_MEMORY_COST = 262_144  # KiB (256 MiB)
MAX_TIME_COST = 10
MAX_PARALLELISM = 8
MIN_LENGTH = 12
MAX_LENGTH = 256

_HASHER = PasswordHasher(
    time_cost=TIME_COST,
    memory_cost=MEMORY_COST,
    parallelism=PARALLELISM,
    type=Type.ID,
)
_PHC = re.compile(
    r"\$argon2id\$v=19\$m=([1-9]\d*),t=([1-9]\d*),p=([1-9]\d*)"
    r"\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}"
)


class PasswordRuleError(ValueError):
    """A password or a supplied hash that the rules do not accept."""


def _normalised(password: str) -> str:
    return unicodedata.normalize("NFC", password)


def _secret(password: str) -> bytes:
    """The bytes Argon2 sees; never raises, so Argon2 always runs.

    ``check_password_rules`` refuses lone surrogates, so ``surrogatepass`` only
    matters for login attempts, which must cost one Argon2 run like any other.
    """
    return _normalised(password).encode("utf-8", "surrogatepass")


# Computed at import, so even the first unknown-user login costs one run only.
_DUMMY_HASH = _HASHER.hash(b"ontocurator timing equaliser")


def check_password_rules(username: str, password: str) -> None:
    """Refuse a password that is too short, too long or equal to the username.

    Lengths count characters after NFC normalisation.
    """
    password = _normalised(password)
    try:
        password.encode("utf-8")
    except UnicodeEncodeError:
        raise PasswordRuleError(
            "The password contains characters that are not valid Unicode text."
        ) from None
    if len(password) < MIN_LENGTH:
        raise PasswordRuleError(
            f"The password must have at least {MIN_LENGTH} characters."
        )
    if len(password) > MAX_LENGTH:
        raise PasswordRuleError(
            f"The password must have at most {MAX_LENGTH} characters."
        )
    if password.strip().casefold() == _normalised(username).strip().casefold():
        raise PasswordRuleError("The password must differ from the username.")


def hash_password(password: str) -> str:
    """An Argon2id PHC string of ``password`` (NFC) with our parameters."""
    return _HASHER.hash(_secret(password))


def verify_password(stored_hash: str | None, password: str) -> bool:
    """Whether ``password`` matches ``stored_hash``; never raises.

    Argon2 runs once in every case: an unknown user (``None``) or an unusable
    hash is checked against a dummy hash, so the answer takes as long as for
    a real account (T2 index D-j).
    """
    secret = _secret(password)
    if stored_hash is not None:
        try:
            return _HASHER.verify(stored_hash, secret)
        except VerifyMismatchError:
            return False
        except Exception:  # a broken hash, rejected before Argon2 ran
            pass
    # The expected mismatch, or anything else: the answer is False either way.
    with contextlib.suppress(Exception):
        _HASHER.verify(_DUMMY_HASH, secret)
    return False


def needs_rehash(stored_hash: str) -> bool:
    """Whether ``stored_hash`` uses other parameters than ours (or is unusable)."""
    try:
        return _HASHER.check_needs_rehash(stored_hash)
    except Exception:
        return True


def assert_policy(stored_hash: str) -> None:
    """Refuse a supplied hash that is not a usable Argon2id hash within bounds.

    Its parameters must be at least ours and at most the caps.
    """
    match = _PHC.fullmatch(stored_hash)
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
    if (
        memory > MAX_MEMORY_COST
        or time > MAX_TIME_COST
        or parallelism > MAX_PARALLELISM
    ):
        raise PasswordRuleError(
            "The Argon2id parameters must be at most"
            f" m={MAX_MEMORY_COST}, t={MAX_TIME_COST}, p={MAX_PARALLELISM}."
        )
    # Prove that Argon2 can decode it: a mismatch means it ran.
    try:
        _HASHER.verify(stored_hash, b"")
    except VerifyMismatchError:
        return
    except Exception as exc:
        raise PasswordRuleError(
            "The password hash cannot be decoded by Argon2."
        ) from exc
