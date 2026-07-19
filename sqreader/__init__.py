"""sqreader — Squad dedicated-server memory reader."""
# Single source of truth for the agent version. pyproject.toml reads this via
# `[tool.setuptools.dynamic] version = {attr = "sqreader.__version__"}`, and the
# fleet/update system reports + gates on it — so a release is a one-line bump here.
__version__ = "1.1.0"
