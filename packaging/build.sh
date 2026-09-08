#!/usr/bin/env bash
# Compile the agent into a single self-contained Linux binary.
#
#   cp packaging/entitlements.env.example packaging/entitlements.env  # once
#   ./packaging/build.sh                # builds in Docker (default)
#   IN_CONTAINER=1 ./packaging/build.sh # already inside the build image
#
# Output: dist/sqreader-<version>-linux-<arch> plus dist/SHA256SUMS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
IMAGE=sqreader-build

# ---------------------------------------------------------------- in Docker?
if [ "${IN_CONTAINER:-0}" != "1" ]; then
  echo "[build] building image $IMAGE (cached after the first run) ..."
  # Quiet while it works, loud when it does not. `-q ... >/dev/null` threw the
  # output away unconditionally, so a base-image build failure reached CI as a
  # bare "exit code: 100" with no apt output — the one thing needed to fix it.
  if ! docker build -f packaging/Dockerfile.build -t "$IMAGE" packaging/        >/tmp/sqreader-image-build.log 2>&1; then
    echo "[build] image build FAILED; docker output follows:" >&2
    cat /tmp/sqreader-image-build.log >&2
    exit 1
  fi
  echo "[build] compiling inside the container ..."
  exec docker run --rm -v "$ROOT":/src -w /src -e IN_CONTAINER=1 \
       "$IMAGE" -c "./packaging/build.sh"
fi

# ------------------------------------------------------------- entitlements
ENT=packaging/entitlements.env
[ -f "$ENT" ] || { echo "missing $ENT (copy the .example and fill it in)"; exit 1; }
# shellcheck disable=SC1090
. "$ENT"
: "${CENTRAL_URL:?CENTRAL_URL not set in $ENT}"
LOCKED="${LOCKED:-1}"

VERSION=$(python3 -c "import re;print(re.search(r'__version__ = \"([^\"]+)\"',open('sqreader/__init__.py').read()).group(1))")
ARCH=$(uname -m)
OUT="sqreader-${VERSION}-linux-${ARCH}"
echo "[build] sqreader $VERSION -> $OUT  (central=$CENTRAL_URL locked=$LOCKED)"

# ------------------------------------------------------------- staged source
# Compile from a COPY. Baking build_config.py in place would leave the working
# tree holding a locked config, which then leaks into the next dev run and, far
# worse, into a commit.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -r sqreader data "$STAGE"/
cd "$STAGE"

python3 - "$CENTRAL_URL" "$LOCKED" <<'PY'
import sys, pathlib
url, locked = sys.argv[1], sys.argv[2] != "0"
p = pathlib.Path("sqreader/build_config.py")
src = p.read_text(encoding="utf-8")
src = src.replace('BAKED_CENTRAL_URL: str = ""',
                  f'BAKED_CENTRAL_URL: str = "{url}"')
src = src.replace("LOCKED: bool = False", f"LOCKED: bool = {locked}")
p.write_text(src, encoding="utf-8")
# Fail loudly rather than shipping an unlocked binary that looks locked.
assert url in p.read_text(encoding="utf-8"), "failed to bake CENTRAL_URL"
print(f"  baked build_config: {url} locked={locked}")
PY

# ------------------------------------------------------------------- compile
# --include-data-dir: data/static must travel INSIDE the binary; the reader
#   resolves it relative to the module tree and silently renders no maps
#   without it.
# icons / sqmaps / frontend are deliberately NOT embedded (~66 MB) — they ship
#   as a sibling asset tree so a self-update does not re-download them.
# no strip: stripping a onefile artifact corrupts the appended payload.
python3 -m nuitka \
    --standalone --onefile \
    --assume-yes-for-downloads \
    --include-package=sqreader \
    --include-package=zstandard \
    --include-package=cryptography \
    --include-module=_cffi_backend \
    --include-data-dir=data/static=data/static \
    --python-flag=no_docstrings \
    --python-flag=no_asserts \
    --product-name=sqreader \
    --product-version="${VERSION}" \
    --output-filename="$OUT" \
    --output-dir=build \
    sqreader/__main__.py

# ---------------------------------------------------------------- smoke test
# A binary that starts is not a binary that works. `selftest` exercises the
# fragile parts THROUGH THE ARTIFACT (not the build venv): cryptography's Rust
# extension against system OpenSSL, the zstandard C extension, and whether
# data/static actually got embedded.
BIN="build/$OUT"
echo "[build] smoke test ..."
"./$BIN" version
"./$BIN" version --json | grep -q '"compiled": true' \
  || { echo "FAIL: artifact does not report itself as compiled"; exit 1; }
"./$BIN" selftest \
  || { echo "FAIL: selftest failed inside the artifact"; exit 1; }
if [ "$LOCKED" != "0" ]; then
  "./$BIN" version | grep -q "$CENTRAL_URL" \
    || { echo "FAIL: central URL not baked into the artifact"; exit 1; }
fi

# ------------------------------------------------------------------- publish
cd "$ROOT"
mkdir -p dist
cp "$STAGE/build/$OUT" "dist/$OUT"
chmod +x "dist/$OUT"
( cd dist && sha256sum "$OUT" > SHA256SUMS )
echo "[build] done -> dist/$OUT"
( cd dist && cat SHA256SUMS )
