"""User languages accept three-letter codes (hp-dtp, hp-nna translations, #86)."""

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
NAME = "ck_user_languages_language"


def upgrade() -> None:
    op.drop_constraint(NAME, "user_languages", schema=SCHEMA)
    op.create_check_constraint(
        op.f(NAME), "user_languages", "language ~ '^[a-z]{2,3}$'", schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_constraint(NAME, "user_languages", schema=SCHEMA)
    op.create_check_constraint(
        op.f(NAME), "user_languages", "language ~ '^[a-z]{2}$'", schema=SCHEMA
    )
