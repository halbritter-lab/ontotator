"""The test-only cheap Argon2 parameters (tests/conftest.py) are in effect here."""

from ontotator.auth.passwords import hash_password, needs_rehash, verify_password


def test_hashes_outside_the_password_tests_use_the_cheap_parameters() -> None:
    stored = hash_password("correct horse battery staple")

    assert stored.startswith("$argon2id$v=19$m=8192,t=1,p=1$")
    assert verify_password(stored, "correct horse battery staple")
    assert needs_rehash(stored) is False
