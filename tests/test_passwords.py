"""Argon2id password hashing, the supplied-hash policy and the password rules."""

import pytest
from argon2 import PasswordHasher

from ontocurator.auth.passwords import (
    PasswordRuleError,
    assert_policy,
    check_password_rules,
    hash_password,
    verify_password,
)

PASSWORD = "correct horse battery"


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
