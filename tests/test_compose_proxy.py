"""The optional reverse-proxy stack — the parts of it that fail QUIETLY.

Nothing here tests Caddy; it tests the wiring mistakes that produce a container
which starts, looks healthy, and is wrong:

  * an upstream of 127.0.0.1 instead of the compose service name. Inside the
    proxy container loopback is its own, where nothing listens, so every
    request 502s while both containers sit there "up".
  * an upstream port that has drifted from the one the entrypoint actually
    serves on. Same symptom, and neither file mentions the other.
  * /data as anything but a persistent named volume. Certificates and the ACME
    account key live there; lose them and every restart orders a fresh
    certificate until Let's Encrypt rate-limits the domain. The damage lands
    days after the change that caused it.
  * a default for SQREADER_SITE. Defaulting it does not break the stack, it
    makes the stack confidently serve the wrong thing — a certificate for a
    name you do not own, or plain HTTP on a public box.
  * a missing udp/443 publish. Caddy advertises HTTP/3 by default; browsers
    cache the advertisement and stall on a dead port before falling back.
  * an uncommented `tls {$LETSENCRYPT_EMAIL}` while .env leaves the variable
    empty. Caddy exits with "wrong argument count" and the proxy never comes
    up, so the two halves of that pair have to move together.

Plus the promise docker-compose.proxy.yml makes by being optional: the base
stack stays standalone, defines no proxy of its own, and keeps publishing 8080.

The compose assertions go through `docker compose config --format json`, the
same way `compose_config()` in test_docker_entrypoint.py does — that renders
and MERGES both files, so a bad indent or a broken two-file merge fails here
instead of at `up -d`. Caddyfile assertions stay textual because it is not
YAML; those are the only ones that still run without Docker installed.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

from conftest import needs_docker

REPO = Path(__file__).resolve().parent.parent
BASE = REPO / "docker-compose.yml"
PROXY = REPO / "docker-compose.proxy.yml"
CADDYFILE = (REPO / "deploy" / "Caddyfile").read_text()
ENTRYPOINT = (REPO / "docker" / "entrypoint.sh").read_text()

# Caddyfile lines Caddy actually acts on, comments and blanks dropped.
ACTIVE = [ln.strip() for ln in CADDYFILE.splitlines()
          if ln.strip() and not ln.strip().startswith("#")]

# Enough to satisfy the base stack's required variables; the game server they
# name never has to exist for `config` to render.
GAME = {"SQUAD_PID_MODE": "host", "SQUAD_APPARMOR": "unconfined",
        "SQUAD_DATA": "/srv/squad"}


def compose(tmp_path, *files, **env):
    """Render the given compose files. Returns (returncode, stdout, stderr).

    The env is passed through an --env-file AND scrubbed from the inherited
    environment, because a developer who happens to export SQREADER_SITE would
    otherwise make the "this must be required" test pass for the wrong reason.
    """
    env_file = tmp_path / "test.env"
    env_file.write_text("".join(f"{k}={v}\n" for k, v in env.items()),
                        encoding="utf-8")
    clean = {k: v for k, v in os.environ.items()
             if not k.startswith(("SQUAD_", "SQREADER_", "PROXY_",
                                  "LETSENCRYPT_", "COMPOSE_"))}
    argv = ["docker", "compose", "--env-file", str(env_file)]
    for f in files:
        argv += ["-f", str(f)]
    argv += ["config", "--format", "json"]
    proc = subprocess.run(argv, capture_output=True, text=True, timeout=120,
                          cwd=REPO, env=clean)
    return proc.returncode, proc.stdout, proc.stderr


def proxy_service(tmp_path, **env):
    rc, out, err = compose(tmp_path, BASE, PROXY, **{**GAME, **env})
    assert rc == 0, err
    return json.loads(out)


@needs_docker
def test_the_two_files_merge_into_one_working_stack(tmp_path):
    """The check that only `up -d` used to make: does the merge even render."""
    cfg = proxy_service(tmp_path, SQREADER_SITE="replays.example.com")
    assert set(cfg["services"]) == {"sqreader", "proxy"}
    # One project, one network, or the service name below resolves to nothing.
    assert (cfg["services"]["proxy"]["networks"].keys()
            == cfg["services"]["sqreader"]["networks"].keys())


def test_upstream_is_the_service_name_not_loopback():
    # SQREADER_UPSTREAM exists so the same file works under a plain `caddy run`
    # outside compose. The DEFAULT is what the proxy container gets, and there
    # loopback is the container's own — so it must stay the service name.
    assert "reverse_proxy {$SQREADER_UPSTREAM:sqreader:8080}" in ACTIVE
    assert not [ln for ln in ACTIVE if "127.0.0.1" in ln or "localhost" in ln]


def test_caddy_upstream_matches_the_port_the_entrypoint_serves():
    """entrypoint.sh hardcodes the container-side port; nothing links the two."""
    served = re.findall(r"--port\s+(\d+)", ENTRYPOINT)
    assert served, "entrypoint.sh no longer passes --port"
    # Tolerates both the bare upstream and the {$VAR:default} wrapper.
    upstream = re.findall(r"reverse_proxy\s+(?:\{\$\w+:)?sqreader:(\d+)",
                          "\n".join(ACTIVE))
    assert upstream == served[:1], (
        f"Caddyfile proxies to {upstream}, entrypoint serves on {served}")


@needs_docker
def test_certificates_live_in_a_named_volume(tmp_path):
    cfg = proxy_service(tmp_path, SQREADER_SITE="replays.example.com")
    data = [v for v in cfg["services"]["proxy"]["volumes"]
            if v["target"] == "/data"]
    assert len(data) == 1 and data[0]["type"] == "volume", \
        "ACME state must survive a restart"
    assert data[0]["source"] in cfg["volumes"]


@needs_docker
def test_http3_is_published_over_udp(tmp_path):
    cfg = proxy_service(tmp_path, SQREADER_SITE="replays.example.com")
    protos = {(p["target"], p["protocol"])
              for p in cfg["services"]["proxy"]["ports"]}
    assert (443, "udp") in protos, "Caddy advertises HTTP/3 whether or not it routes"
    assert (443, "tcp") in protos


@needs_docker
def test_site_address_is_required_not_defaulted(tmp_path):
    rc, _, err = compose(tmp_path, BASE, PROXY, **GAME)
    assert rc != 0, "SQREADER_SITE must fail loudly when unset"
    assert "SQREADER_SITE" in err


def test_acme_email_directive_and_its_variable_move_together():
    """Either the tls line stays commented, or the variable becomes required."""
    if any(re.match(r"tls\s+\{\$LETSENCRYPT_EMAIL\}", ln) for ln in ACTIVE):
        assert re.search(r'LETSENCRYPT_EMAIL:\s*"?\$\{LETSENCRYPT_EMAIL:\?',
                         PROXY.read_text()), \
            "an empty LETSENCRYPT_EMAIL stops Caddy booting"


@needs_docker
def test_base_stack_stands_alone(tmp_path):
    rc, out, err = compose(tmp_path, BASE, **GAME)
    assert rc == 0, err
    cfg = json.loads(out)
    assert "proxy" not in cfg["services"], \
        "the proxy belongs in docker-compose.proxy.yml, which is optional"
    # The host-webserver path documented in the README reaches the reader
    # through this publish rather than through the proxy container.
    published = {(p.get("host_ip"), p["target"])
                 for p in cfg["services"]["sqreader"]["ports"]}
    assert ("127.0.0.1", 8080) in published
