"""Repository and global configuration discovery."""

from __future__ import annotations

import json
import os
from pathlib import Path

from vibe_stack.errors import VibeStackError
from vibe_stack.model import GroupRef

_GLOBAL_DIR = ".config"
_GLOBAL_NAME = "vibestack"
_CONFIG_FILE = "config.json"
_DEFAULT_CORE = GroupRef(name="core", version="0.1.0")


def global_config_path() -> Path:
    """Return ``~/.config/vibestack/config.json``."""
    return Path.home() / _GLOBAL_DIR / _GLOBAL_NAME / _CONFIG_FILE


def read_global_config() -> dict[str, object]:
    """Read the global VibeStack config, or an empty dict when absent."""
    path = global_config_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise VibeStackError(f"invalid JSON in {path}: {exc}") from exc
    return data if isinstance(data, dict) else {}


def write_global_config(data: dict[str, object]) -> Path:
    """Write the global VibeStack config and return its path."""
    path = global_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return path


def default_core() -> GroupRef:
    """Return the configured default core group or ``core/0.1.0``."""
    data = read_global_config()
    core = data.get("core")
    if isinstance(core, dict):
        return GroupRef(
            name=str(core.get("name", "core")),
            version=str(core.get("version", _DEFAULT_CORE.version)),
        )
    return _DEFAULT_CORE


def find_repo(explicit: Path | None = None) -> Path:
    """Locate the VibeStack repository.

    Priority: explicit path, ``VIBESTACK_HOME`` / ``VIBESTACK_REPO``,
    global config ``repository``, current directory, home directory.
    """
    if explicit is not None:
        if (explicit / "capability-groups").is_dir():
            return explicit.resolve()
        raise VibeStackError(f"not a VibeStack repository: {explicit}")

    candidates: list[Path] = []
    for env_name in ("VIBESTACK_HOME", "VIBESTACK_REPO"):
        value = os.environ.get(env_name)
        if value:
            candidates.append(Path(value))
    configured = read_global_config().get("repository")
    if isinstance(configured, str) and configured:
        candidates.append(Path(configured))
    candidates.extend([Path.cwd(), Path.home()])

    for candidate in candidates:
        if (candidate / "capability-groups").is_dir():
            return candidate.resolve()

    raise VibeStackError(
        "VibeStack repository not found; pass --repo, set VIBESTACK_HOME, "
        "or run `vibe-stack init`"
    )
