"""One person as another user sees them (spec "Identity", D1)."""

from pydantic import BaseModel


class PersonRefView(BaseModel):
    """``display_name`` only for lead callers or the caller's own record."""

    pseudonym: str
    display_name: str | None = None
    is_me: bool = False
