import hashlib
from typing import Any

import rfc8785


def canonical_json_bytes(obj: Any) -> bytes:
    """Serialize object to canonical JSON bytes according to RFC 8785 (JCS)."""
    return rfc8785.dumps(obj)


def canonical_hash(obj: Any) -> str:
    """Compute hex-encoded SHA-256 hash of RFC-8785 canonical JSON bytes."""
    payload = canonical_json_bytes(obj)
    return hashlib.sha256(payload).hexdigest()
