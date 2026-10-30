# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.11@sha256:77280f2f771df71f90786c314fe1bbc1e023feac652969bbf139c280babf2eb7 AS uv
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS build
COPY --from=uv /uv /uvx /usr/local/bin/
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml uv.lock README.md LICENSE THIRD_PARTY_NOTICES.md ./
COPY LICENSES/ ./LICENSES/
COPY src/ ./src/
# Replace committed assets, so a renamed JS bundle cannot leave stale files.
RUN rm -rf src/ontotator/web
COPY --from=web /web/dist/ ./src/ontotator/web/
# The optional github_token BuildKit secret is read by a credential helper only
# when it is non-empty; otherwise GitHub is fetched anonymously. The credential
# never enters the dependency URL, lockfile, image history or a persisted config.
RUN --mount=type=secret,id=github_token,required=false \
    --mount=type=cache,target=/root/.cache/uv \
    if [ -s /run/secrets/github_token ]; then \
        export GIT_CONFIG_COUNT=1 \
            GIT_CONFIG_KEY_0=credential.helper \
            GIT_CONFIG_VALUE_0='!f() { if [ "$1" = get ]; then printf "username=x-access-token\npassword="; cat /run/secrets/github_token; printf "\n"; fi; }; f'; \
    fi \
    && uv sync --frozen --no-dev --no-editable --compile-bytecode

FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && python -m pip uninstall -y pip \
    && groupadd --gid 1001 ontotator \
    && useradd --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin ontotator \
    && mkdir /data \
    && chown 1001:1001 /data
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY THIRD_PARTY_NOTICES.md ./
COPY LICENSES/ ./LICENSES/
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ONTOTATOR_ENV=production \
    ONTOTATOR_DATA_DIR=/data
# The Git commit, shown in the app's Help (/api/v1/about); late, so it does not bust the layer cache.
ARG ONTOTATOR_REVISION=""
ENV ONTOTATOR_REVISION=$ONTOTATOR_REVISION
USER 1001:1001
EXPOSE 8000
VOLUME ["/data"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=4).close()"]
ENTRYPOINT ["/usr/bin/tini", "--", "ontotator"]
CMD ["serve", "--production"]
