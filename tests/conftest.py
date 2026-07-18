"""Make the `sqreader` package importable no matter where pytest is
invoked from (repo root is one level up from this tests/ dir)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
