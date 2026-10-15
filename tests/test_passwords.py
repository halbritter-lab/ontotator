"""Argon2id password hashing, the supplied-hash policy and the password rules."""

from collections.abc import Callable
from typing import Any

import argon2._password_hasher
import pytest
from argon2 import PasswordHasher, Type
from argon2.exceptions import VerifyMismatchError

from ontocurator.auth.passwords import (
    PasswordRuleError,
    assert_policy,
    check_password_rules,
    hash_password,
    needs_rehash,
    verify_password,
)

PASSWORD = "correct horse battery"
OURS = hash_password(PASSWORD)


def test_a_hash_verifies_its_password_only() -> None:
    stored = hash_password(PASSWORD)

    assert stored.startswith("$argon2id$v=19$m=19456,t=2,p=1$")
    assert verify_password(stored, PASSWORD)
    assert not verify_password(stored, PASSWORD + "!")


def test_an_unknown_user_never_verifies() -> None:
    assert verify_password(None, PASSWORD) is False


def test_a_broken_hash_does_not_verify() -> None:
    assert verify_password("$argon2id$v=19$garbage", PASSWORD) is False
    assert verify_password("not a hash at all", PASSWORD) is False


@pytest.mark.parametrize(
    ("stored", "password"),
    [
        (OURS, PASSWORD + "!"),
        (None, PASSWORD),
        ("$argon2id$v=19$garbage", PASSWORD),
        ("not a hash at all", PASSWORD),
        ("$argon2id$v=19$m=19456,t=2,p=1$ä$ö", PASSWORD),
        (OURS, "\ud800" * 12),
        (None, "\ud800" * 12),
    ],
    ids=[
        "wrong",
        "unknown",
        "broken",
        "no-hash",
        "non-ascii",
        "surrogate",
        "unknown-surrogate",
    ],
)
def test_a_failed_login_runs_argon2_exactly_once(
    monkeypatch: pytest.MonkeyPatch, stored: str | None, password: str
) -> None:
    runs: list[bool] = []
    real: Callable[..., Any] = argon2._password_hasher.verify_secret

    def counting(*args: Any) -> Any:
        try:
            result = real(*args)
        except VerifyMismatchError:
            runs.append(False)
            raise
        runs.append(result)
        return result

    monkeypatch.setattr(argon2._password_hasher, "verify_secret", counting)

    assert verify_password(stored, password) is False
    assert runs == [False]


@pytest.mark.parametrize(
    ("username", "password", "message"),
    [
        ("alice", "short", "at least 12"),
        ("alice", "x" * 257, "at most 256"),
        ("alice.example", "Alice.Example", "differ from the username"),
    ],
)
def test_passwords_that_break_the_rules_are_refused(
    username: str, password: str, message: str
) -> None:
    with pytest.raises(PasswordRuleError, match=message):
        check_password_rules(username, password)


def test_a_password_unicode_cannot_encode_is_refused() -> None:
    with pytest.raises(PasswordRuleError, match="Unicode"):
        check_password_rules("alice", "a lone surrogate \ud800 here")


def test_passwords_are_compared_in_unicode_nfc() -> None:
    composed, decomposed = "café au lait!", "café au lait!"

    assert verify_password(hash_password(composed), decomposed)
    assert verify_password(hash_password(decomposed), composed)
    # Eleven characters after NFC, although 22 code points as typed.
    with pytest.raises(PasswordRuleError, match="at least 12"):
        check_password_rules("alice", "é" * 11)
    with pytest.raises(PasswordRuleError, match="differ from the username"):
        check_password_rules("josé.example", "José.Example")


def test_a_long_passphrase_is_accepted() -> None:
    passphrase = "a sentence that is long, simple and easy to remember " * 4

    check_password_rules("alice", passphrase[:256])
    assert verify_password(hash_password(passphrase), passphrase)


def test_a_supplied_hash_must_be_argon2id_with_our_parameters() -> None:
    assert_policy(hash_password(PASSWORD))

    weaker = PasswordHasher(time_cost=1, memory_cost=8192).hash(PASSWORD)
    with pytest.raises(PasswordRuleError, match="at least"):
        assert_policy(weaker)

    bcrypt = "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW"
    with pytest.raises(PasswordRuleError, match="Argon2id"):
        assert_policy(bcrypt)


@pytest.mark.parametrize(
    ("supplied", "message"),
    [
        (OURS + "\n", "Argon2id"),
        (OURS.replace("m=19456", "m=019456"), "Argon2id"),
        (OURS.replace(",p=1$", ",p=0$"), "Argon2id"),
        (
            PasswordHasher(time_cost=2, memory_cost=19456, type=Type.I).hash("x"),
            "Argon2id",
        ),
        (OURS.replace("m=19456", "m=4194304"), "at most"),
        (OURS.replace(",t=2,", ",t=11,"), "at most"),
        (OURS.replace(",p=1$", ",p=9$"), "at most"),
        ("$argon2id$v=19$m=19456,t=2,p=1$AAAA$AAAA", "decoded"),
    ],
    ids=[
        "trailing-newline",
        "leading-zero",
        "p-zero",
        "argon2i",
        "memory-above-cap",
        "time-above-cap",
        "parallelism-above-cap",
        "undecodable",
    ],
)
def test_a_supplied_hash_outside_the_policy_is_refused(
    supplied: str, message: str
) -> None:
    with pytest.raises(PasswordRuleError, match=message):
        assert_policy(supplied)


def test_only_hashes_with_other_parameters_need_a_rehash() -> None:
    assert needs_rehash(OURS) is False
    assert needs_rehash(PasswordHasher(time_cost=3).hash(PASSWORD)) is True
    assert needs_rehash("not a hash at all") is True
