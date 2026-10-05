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
