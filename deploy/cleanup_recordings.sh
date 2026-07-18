#!/bin/bash
# Prune SqReader match recordings.
#
# Recordings accumulate at roughly 250 MB/day and nothing else ever deletes them.
# On a box that also runs the game server, filling the disk is the worst failure
# we have: it takes Squad down with SqReader. This is the safety valve.
#
# Safety rules that always apply:
#   * A file modified within IN_PROGRESS_MIN minutes is the match being recorded
#     RIGHT NOW. Never touch it — deleting it would corrupt a live capture.
#   * A .sqrx is deleted together with its .meta.json sidecar.
#   * --dry-run prints what would go and changes nothing.
#
# Policies — set any combination; each is skipped when left at 0:
#   --max-age-days N   drop recordings older than N days
#   --max-total-gb N   drop oldest until the directory fits in N GB
#   --min-free-gb N    drop oldest until the filesystem has N GB free
#
# Exit code is 0 even when nothing matched, so the systemd timer stays green.
set -euo pipefail

DIR="./recordings"
MAX_AGE_DAYS=0
MAX_TOTAL_GB=0
MIN_FREE_GB=0
IN_PROGRESS_MIN=60
DRY_RUN=0

while [ $# -gt 0 ]; do
    case "$1" in
        --dir)            DIR="$2"; shift 2 ;;
        --max-age-days)   MAX_AGE_DAYS="$2"; shift 2 ;;
        --max-total-gb)   MAX_TOTAL_GB="$2"; shift 2 ;;
        --min-free-gb)    MIN_FREE_GB="$2"; shift 2 ;;
        --in-progress-min) IN_PROGRESS_MIN="$2"; shift 2 ;;
        --dry-run)        DRY_RUN=1; shift ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

[ -d "$DIR" ] || { echo "recordings dir not found: $DIR" >&2; exit 1; }

log() { echo "[retention] $*"; }
[ "$DRY_RUN" = "1" ] && log "DRY RUN — nothing will be deleted"

gb() { awk -v b="$1" 'BEGIN { printf "%.2f", b / 1073741824 }'; }

# Candidates: every .sqrx that is NOT the in-flight recording, oldest first.
# `-mmin +N` is the in-progress guard; it must hold for every policy below.
mapfile -t CANDIDATES < <(
    find "$DIR" -maxdepth 1 -type f -name '*.sqrx' -mmin "+$IN_PROGRESS_MIN" \
        -printf '%T@\t%s\t%p\n' 2>/dev/null | sort -n
)

TOTAL_BYTES=$(find "$DIR" -maxdepth 1 -type f -name '*.sqrx' -printf '%s\n' 2>/dev/null \
              | awk '{ s += $1 } END { print s + 0 }')
log "dir=$DIR  recordings=$(find "$DIR" -maxdepth 1 -name '*.sqrx' | wc -l)  size=$(gb "$TOTAL_BYTES") GB  prunable=${#CANDIDATES[@]}"

DELETED=0
FREED=0

# Deletes one .sqrx plus its sidecar, and books the bytes.
drop() {
    local path="$1" size="$2" why="$3"
    local meta="${path%.sqrx}.meta.json"
    if [ "$DRY_RUN" = "1" ]; then
        log "WOULD DELETE ($why): $(basename "$path")  $(gb "$size") GB"
    else
        rm -f -- "$path" "$meta"
        log "deleted ($why): $(basename "$path")  $(gb "$size") GB"
    fi
    DELETED=$((DELETED + 1))
    FREED=$((FREED + size))
    TOTAL_BYTES=$((TOTAL_BYTES - size))
}

# Marks a candidate consumed so a later policy can't count it twice.
declare -A GONE=()

# --- Policy 1: age ---------------------------------------------------------
if [ "$MAX_AGE_DAYS" -gt 0 ]; then
    CUTOFF=$(date -d "$MAX_AGE_DAYS days ago" +%s)
    for row in "${CANDIDATES[@]}"; do
        mtime=${row%%.*}                      # %T@ is float; seconds is enough
        rest=${row#*$'\t'}; size=${rest%%$'\t'*}; path=${rest#*$'\t'}
        [ -n "${GONE[$path]:-}" ] && continue
        if [ "$mtime" -lt "$CUTOFF" ]; then
            drop "$path" "$size" "older than ${MAX_AGE_DAYS}d"
            GONE[$path]=1
        fi
    done
fi

# --- Policy 2: total size cap ---------------------------------------------
if [ "$MAX_TOTAL_GB" -gt 0 ]; then
    CAP=$((MAX_TOTAL_GB * 1073741824))
    for row in "${CANDIDATES[@]}"; do
        [ "$TOTAL_BYTES" -le "$CAP" ] && break
        rest=${row#*$'\t'}; size=${rest%%$'\t'*}; path=${rest#*$'\t'}
        [ -n "${GONE[$path]:-}" ] && continue
        drop "$path" "$size" "over ${MAX_TOTAL_GB}GB cap"
        GONE[$path]=1
    done
fi

# --- Policy 3: keep the filesystem breathing -------------------------------
if [ "$MIN_FREE_GB" -gt 0 ]; then
    for row in "${CANDIDATES[@]}"; do
        free_gb=$(df -BG --output=avail "$DIR" | tail -1 | tr -dc '0-9')
        [ "$free_gb" -ge "$MIN_FREE_GB" ] && break
        rest=${row#*$'\t'}; size=${rest%%$'\t'*}; path=${rest#*$'\t'}
        [ -n "${GONE[$path]:-}" ] && continue
        drop "$path" "$size" "free space below ${MIN_FREE_GB}GB"
        GONE[$path]=1
    done
fi

if [ "$DELETED" -eq 0 ]; then
    log "nothing to prune"
else
    log "pruned $DELETED recording(s), $(gb "$FREED") GB — dir now $(gb "$TOTAL_BYTES") GB"
fi
