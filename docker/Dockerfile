# The reader, for running beside a Squad server rather than on it.
#
# Built from source rather than from packaging/build.sh's Nuitka artifact. That
# artifact exists to spare operators a Python toolchain, which an image supplies
# anyway — and building from source has a second, larger benefit: for a source
# install `updater.running_binary(compiled=False)` returns None, so remote
# self-update (which stages a binary and expects systemd's ExecStartPre to swap
# it) is inert BY CONSTRUCTION rather than by a flag someone can flip in an
# image that cannot rewrite itself.
FROM python:3.11-slim-bookworm

# procps supplies pidof, which is find_squad_server_pid's first and most
# reliable branch (config.py). Without it, resolution silently degrades to the
# generic /proc scan — which happens to work only because "SquadGameServer" is
# exactly 15 characters and so survives comm truncation. Not a coincidence
# worth depending on.
RUN apt-get update \
 && apt-get install -y --no-install-recommends procps \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

# .[fast] pulls numpy, which vectorises the incremental GUObjectArray diff.
# numpy and zstandard both ship manylinux wheels, so no compiler is needed.
RUN pip install --no-cache-dir ".[fast]" \
 && chmod +x docker/entrypoint.sh

# No USER line, deliberately. CAP_SYS_PTRACE and CAP_DAC_READ_SEARCH are only
# effective for uid 0, and both are required to read the game's memory.
ENTRYPOINT ["/app/docker/entrypoint.sh"]
