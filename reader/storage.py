"""Config and JSON storage for directories / share links."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / 'config.yaml'
DIRECTORIES_FILE = BASE_DIR / 'directories.json'
SHARE_LINKS_FILE = BASE_DIR / 'share_links.json'

_config: dict[str, Any] | None = None


def load_config(force: bool = False) -> dict[str, Any]:
    """Load config.yaml (cached unless force=True)."""
    global _config
    if _config is not None and not force:
        return _config
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        _config = yaml.safe_load(f) or {}
    return _config


def get_config() -> dict[str, Any]:
    return load_config()


def load_directories_config() -> list:
    """Load directory config, prefer directories.json over config.yaml."""
    if DIRECTORIES_FILE.exists():
        try:
            with open(DIRECTORIES_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
    return get_config().get('directories', []) or []


def save_directories_config(directories: list) -> None:
    with open(DIRECTORIES_FILE, 'w', encoding='utf-8') as f:
        json.dump(directories, f, ensure_ascii=False, indent=2)


def load_share_links() -> list:
    if not SHARE_LINKS_FILE.exists():
        return []
    try:
        with open(SHARE_LINKS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_share_links(links: list) -> None:
    with open(SHARE_LINKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(links, f, ensure_ascii=False, indent=2)
