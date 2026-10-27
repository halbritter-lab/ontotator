#!/usr/bin/env bash
# Build the production image locally (no CI), push it to GHCR and print the
# digest reference for ONTOTATOR_IMAGE in .env.docker.
# Usage: bash scripts/publish-image.sh VERSION
# Needs `docker login ghcr.io` with a token that may write packages. The build
# token for the private ontospan dependency comes from GITHUB_TOKEN_FILE or,
# if unset, from the authenticated GitHub CLI (`gh auth token`).
set -euo pipefail
cd "$(dirname "$0")/.."

repository=ghcr.io/janpower/ontotator
version="${1:-}"
if [[ ! "$version" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ || "$version" == latest ]]; then
    echo "Usage: bash scripts/publish-image.sh VERSION (a Docker tag such as 0.4.0, not latest)" >&2
    exit 2
fi
# Separate assignments so set -e stops on a git failure.
changes="$(git status --porcelain)"
revision="$(git rev-parse HEAD)"
if [[ -n "$changes" ]]; then
    echo "Refusing to publish: the working tree has uncommitted changes." >&2
    exit 1
fi

if [[ -n "${GITHUB_TOKEN_FILE:-}" ]]; then
    secret="id=github_token,src=$GITHUB_TOKEN_FILE"
else
    GITHUB_TOKEN="$(gh auth token)"
    export GITHUB_TOKEN
    secret="id=github_token,env=GITHUB_TOKEN"
fi
docker build --secret "$secret" \
    --label "org.opencontainers.image.revision=$revision" \
    --label "org.opencontainers.image.version=$version" \
    -t "$repository:$version" -t "$repository:latest" .
unset GITHUB_TOKEN

docker push "$repository:$version"
docker push "$repository:latest"
digest="$(docker buildx imagetools inspect "$repository:$version" --format '{{ .Manifest.Digest }}')"
if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "Could not read the pushed digest of $repository:$version." >&2
    exit 1
fi
echo "Pushed $repository:$version"
echo "ONTOTATOR_IMAGE=$repository@$digest"
