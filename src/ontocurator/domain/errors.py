from typing import Any


class DomainError(Exception):
    """Base domain error for editor domain operations."""

    def __init__(self, code: str, details: str | dict[str, Any] | None = None) -> None:
        super().__init__(f"[{code}] {details}" if details else code)
        self.code = code
        self.details = details


class RevisionConflict(DomainError):
    """Raised when expected draft revision does not match current database revision."""

    def __init__(self, details: str | dict[str, Any] | None = None) -> None:
        super().__init__("REVISION_CONFLICT", details)


class InvalidPackage(DomainError):
    """Raised when work package format, checksums or contents fail validation."""

    def __init__(self, details: str | dict[str, Any] | None = None) -> None:
        super().__init__("INVALID_PACKAGE", details)


class InvalidAnnotation(DomainError):
    """Raised when annotation or evidence fails structural or domain validation."""

    def __init__(self, details: str | dict[str, Any] | None = None) -> None:
        super().__init__("INVALID_ANNOTATION", details)


class PayloadTooLarge(DomainError):
    """Raised when an uploaded body exceeds its configured size limit."""

    def __init__(self, details: str | dict[str, Any] | None = None) -> None:
        super().__init__("PAYLOAD_TOO_LARGE", details)


class IncompleteReview(DomainError):
    """Raised when attempting to submit a review without all required decisions."""

    def __init__(self, details: str | dict[str, Any] | None = None) -> None:
        super().__init__("INCOMPLETE_REVIEW", details)


class ModeNotAllowed(DomainError):
    """Raised when a working mode is disabled by the distribution settings."""

    def __init__(self, details: str | dict[str, Any] | None = None) -> None:
        super().__init__("MODE_NOT_ALLOWED", details)


class AccessDenied(DomainError):
    """Raised when the principal may not do or see what it asked for (HTTP 403)."""


class NotAuthenticated(DomainError):
    """Raised when a request has no logged-in principal (HTTP 401)."""

    def __init__(self) -> None:
        super().__init__("NOT_AUTHENTICATED", "Log in to continue.")


LOGIN_FAILED_MESSAGE = (
    "Username or password is wrong, or the account is locked for 15 minutes."
)


class LoginFailed(DomainError):
    """Raised for every failed login, whatever the reason (HTTP 401, index D-j).

    The message is fixed, so a reply never tells a wrong password, an unknown
    user, an inactive account and a lockout apart (Q8).
    """

    def __init__(self) -> None:
        super().__init__("LOGIN_FAILED", LOGIN_FAILED_MESSAGE)
