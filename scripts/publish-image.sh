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
# Published tags are immutable: a hotfix gets a new VERSION.
if docker buildx imagetools inspect "$repository:$version" >/dev/null 2>&1; then
    echo "Refusing to publish: $repository:$version already exists." >&2
    exit 1
fi

if [[ -n "${GITHUB_TOKEN_FILE:-}" ]]; then
    secret="id=github_token,src=$GITHUB_TOKEN_FILE"
else
    GITHUB_TOKEN="$(gh auth token)"
    export GITHUB_TOKEN
    secret="id=github_token,env=GITHUB_TOKEN"
fi
# --load: a docker-container buildx builder would otherwise leave a stale local tag.
docker build --load --secret "$secret" \
    --label "org.opencontainers.image.revision=$revision" \
    --label "org.opencontainers.image.version=$version" \
    -t "$repository:$version" .
unset GITHUB_TOKEN

# Pinned Trivy 0.76.1; MSYS_NO_PATHCONV keeps Git Bash from rewriting the socket path.
MSYS_NO_PATHCONV=1 docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
    aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c \
    image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed "$repository:$version"

docker push "$repository:$version"
digest="$(docker buildx imagetools inspect "$repository:$version" --format '{{ .Manifest.Digest }}')"
if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "Could not read the pushed digest of $repository:$version." >&2
    exit 1
fi
echo "Pushed $repository:$version"
echo "ONTOTATOR_IMAGE=$repository@$digest"
