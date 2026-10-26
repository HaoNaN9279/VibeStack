"""Agent plugin adapters: discovery and installation."""

from __future__ import annotations

import shutil
from pathlib import Path

from vibe_stack.errors import PluginNotFoundError, VibeStackError
from vibe_stack.model import read_json
from vibe_stack.repo import read_global_config, write_global_config


def plugins_dir(repo: Path) -> Path:
    """Return the repository plugins directory."""
    return repo / "plugins"


def discover_plugins(repo: Path) -> list[dict[str, object]]:
    """Discover every ``plugins/<agent>/plugin.json``."""
    base = plugins_dir(repo)
    if not base.is_dir():
        return []
    result: list[dict[str, object]] = []
    for manifest in sorted(base.glob("*/plugin.json")):
        try:
            data = read_json(manifest)
        except VibeStackError:
            continue
        data["root"] = manifest.parent
        result.append(data)
    return result


def load_plugin(repo: Path, agent: str) -> tuple[dict[str, object], Path]:
    """Load one plugin adapter manifest."""
    root = plugins_dir(repo) / agent
    manifest = root / "plugin.json"
    if not manifest.is_file():
        raise PluginNotFoundError(f"plugin adapter '{agent}' not found")
    return read_json(manifest), root


def install(repo: Path, agent: str) -> list[Path]:
    """Install a plugin adapter for *agent*.

    Only file copies into the agent's plugin directory are performed.
    The agent's main configuration file is never modified.
    """
    manifest, root = load_plugin(repo, agent)
    entrypoint = str(manifest.get("entrypoint", ""))
    if not entrypoint or not (root / entrypoint).is_file():
        raise PluginNotFoundError(f"plugin '{agent}' entrypoint is missing")

    install_data = manifest.get("install")
    if not isinstance(install_data, dict):
        raise PluginNotFoundError(f"plugin '{agent}' has no install target")
    target = _expand(str(install_data.get("target", "")))
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / entrypoint, target)

    written = [target]
    skills = root / "skills"
    skills_target_raw = install_data.get("skills_target")
    if skills.is_dir() and isinstance(skills_target_raw, str) and skills_target_raw:
        skills_target = _expand(skills_target_raw)
        shutil.copytree(skills, skills_target, dirs_exist_ok=True)
        written.append(skills_target)

    config = read_global_config()
    config["schema_version"] = 1
    config["repository"] = str(repo.resolve())
    write_global_config(config)
    return written


def status(repo: Path, agent: str) -> dict[str, object]:
    """Return installation status for one plugin adapter."""
    manifest, root = load_plugin(repo, agent)
    install_data = manifest.get("install")
    target_raw = install_data.get("target") if isinstance(install_data, dict) else None
    target = _expand(str(target_raw)) if isinstance(target_raw, str) else None
    skills_raw = install_data.get("skills_target") if isinstance(install_data, dict) else None
    skills_target = _expand(str(skills_raw)) if isinstance(skills_raw, str) else None
    return {
        "agent": agent,
        "version": manifest.get("version", ""),
        "source": str(root),
        "target": str(target) if target else "",
        "installed": bool(target and target.is_file()),
        "skills_target": str(skills_target) if skills_target else "",
        "skills_installed": bool(skills_target and skills_target.is_dir()),
    }


def _expand(value: str) -> Path:
    if value.startswith("~"):
        return Path.home() / value[1:].lstrip("/\\")
    return Path(value)
