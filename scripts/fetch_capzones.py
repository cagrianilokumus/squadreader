#!/usr/bin/env python3
"""
Offline builder for data/static/capzones.json — the static cap-zone geometry
layer sqreader merges onto live snapshots (see sqreader/squad/capzones.py).

Walks every layer in data/static/layer_bounds.json, converts each display name
to its SquadCalc RawLayerKey (``Al Basrah RAAS v1`` → ``AlBasrah_RAAS_v1``),
GETs that layer from the SquadCalc API, extracts a compact per-zone geometry
list, and writes them back keyed by the ORIGINAL display name (so the runtime
lookup is a plain dict hit on game_state["mapName"], no conversion).

This runs by hand, occasionally (on a Squad map update), NOT at serve time —
the runtime has zero external dependency on SquadCalc. Raw responses are cached
under scripts/.capzone_cache/ (gitignored) so re-runs are cheap and a layer that
404s once is not retried. Only stdlib (urllib) is used, mirroring recorder.py.

Usage:
    python scripts/fetch_capzones.py                 # fetch all, use cache
    python scripts/fetch_capzones.py --refresh       # ignore cache, re-fetch
    python scripts/fetch_capzones.py --only "Narva"  # only layers matching substr
    python scripts/fetch_capzones.py --limit 5       # first N layers (smoke test)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Make `sqreader` importable when run as `python scripts/fetch_capzones.py`
# from the repo root (mirrors the verify_*.py scripts' assumption).
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqreader.squad.capzones import extract_capzone_data, to_raw_layer_key  # noqa: E402

SQUADCALC_API = "https://squadcalc.app/api"
DEFAULT_DATA_DIR = _REPO_ROOT / "data" / "static"
DEFAULT_CACHE_DIR = _REPO_ROOT / "scripts" / ".capzone_cache"
NOT_FOUND_FILE = "_not_found.json"
USER_AGENT = "sqreader-capzone-fetch/1.0 (+offline static data build)"


def _load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _fetch_raw(raw_key: str, timeout: float) -> dict | None:
    """GET one SquadCalc layer. None on any HTTP/parse failure (caller skips)."""
    url = f"{SQUADCALC_API}/get/layer?name={urllib.parse.quote(raw_key)}"
    req = urllib.request.Request(
        url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    return data if isinstance(data, dict) else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR,
                    help="static data dir (reads layer_bounds.json, writes capzones.json)")
    ap.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR,
                    help="raw-response cache dir (gitignored)")
    ap.add_argument("--only", default=None,
                    help="only process layers whose display name contains this substring")
    ap.add_argument("--limit", type=int, default=None,
                    help="stop after N layers (smoke test)")
    ap.add_argument("--refresh", action="store_true",
                    help="ignore cache; re-fetch every layer (also retries past 404s)")
    ap.add_argument("--sleep", type=float, default=0.4,
                    help="seconds between live API calls (politeness)")
    ap.add_argument("--timeout", type=float, default=15.0, help="per-request timeout")
    args = ap.parse_args()

    data_dir: Path = args.data_dir
    cache_dir: Path = args.cache_dir
    cache_dir.mkdir(parents=True, exist_ok=True)

    layer_bounds = _load_json(data_dir / "layer_bounds.json")
    if not isinstance(layer_bounds, dict) or not layer_bounds:
        print(f"FATAL: no usable layer_bounds.json in {data_dir}", file=sys.stderr)
        return 2

    # Persisted 404 set: RawLayerKeys SquadCalc has no data for. Skipped unless
    # --refresh, so repeated runs don't re-hit dead layers.
    not_found_path = cache_dir / NOT_FOUND_FILE
    not_found: set[str] = set(_load_json(not_found_path) or []) if not args.refresh else set()

    layers = sorted(layer_bounds.keys())
    if args.only:
        needle = args.only.lower()
        layers = [ln for ln in layers if needle in ln.lower()]
    if args.limit is not None:
        layers = layers[:args.limit]

    out: dict[str, list[dict]] = {}
    n_fetched = n_cached = n_empty = n_404 = n_err = 0
    total_zones = total_shapes = 0

    for i, display in enumerate(layers, 1):
        raw_key = to_raw_layer_key(display, layer_bounds)
        if not raw_key:
            continue
        cache_file = cache_dir / f"{raw_key}.json"

        raw: dict | None = None
        if not args.refresh and cache_file.is_file():
            raw = _load_json(cache_file)
            if raw is not None:
                n_cached += 1
        if raw is None:
            if raw_key in not_found and not args.refresh:
                n_404 += 1
                continue
            try:
                raw = _fetch_raw(raw_key, args.timeout)
                if raw is None:
                    raise ValueError("non-dict response")
                cache_file.write_text(json.dumps(raw, ensure_ascii=False),
                                      encoding="utf-8")
                n_fetched += 1
                time.sleep(max(0.0, args.sleep))
            except (urllib.error.HTTPError, urllib.error.URLError,
                    ValueError, OSError) as e:
                # 404 (or any hard failure) → record and move on, no retry storm.
                not_found.add(raw_key)
                is404 = isinstance(e, urllib.error.HTTPError) and e.code == 404
                n_404 += 1 if is404 else 0
                n_err += 0 if is404 else 1
                print(f"  [{i}/{len(layers)}] {display}  ({raw_key})  "
                      f"{'404 no data' if is404 else f'ERR {e!r}'}")
                continue

        points = extract_capzone_data(raw)
        if not points:
            n_empty += 1
            continue
        out[display] = points
        zones = len(points)
        shapes = sum(len(p.get("geometry") or []) for p in points)
        total_zones += zones
        total_shapes += shapes
        print(f"  [{i}/{len(layers)}] {display}  ({raw_key})  "
              f"{zones} zones, {shapes} shapes")

    # Persist the 404 set for next run.
    not_found_path.write_text(json.dumps(sorted(not_found)), encoding="utf-8")

    # Write capzones.json: display-name keyed, sorted, pretty (diff-friendly).
    out_path = data_dir / "capzones.json"
    out_path.write_text(
        json.dumps({k: out[k] for k in sorted(out)}, ensure_ascii=False,
                   indent=1, sort_keys=False) + "\n", encoding="utf-8")

    print("\n" + "=" * 60)
    print(f"layers processed : {len(layers)}")
    print(f"  fetched (live) : {n_fetched}")
    print(f"  from cache     : {n_cached}")
    print(f"  no geometry    : {n_empty}")
    print(f"  404 / no data  : {n_404}")
    print(f"  errors         : {n_err}")
    print(f"layers with data : {len(out)}")
    print(f"total zones      : {total_zones}")
    print(f"total shapes     : {total_shapes}")
    print(f"wrote            : {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
