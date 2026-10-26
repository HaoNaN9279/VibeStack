"""Capability group and tool package loaders."""

from __future__ import annotations

import re
from pathlib import Path

from vibe_stack.errors import GroupNotFoundError, ToolNotFoundError, VibeStackError
from vibe_stack.model import GroupMeta, ToolMeta, read_json

_SEMVER = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)")


def _version_key(version: str) -> tuple[int, ...]:
    match = _SEMVER.match(version)
    if match is None:
        return (0, 0, 0)
    return tuple(int(part) for part in match.groups())


def load_group(repo: Path, name: str, version: str | None = None) -> GroupMeta:
    """Load one capability group.

    When *version* is omitted, choose the highest semver available.
    """
    base = repo / "capability-groups" / name
    if not base.is_dir():
        raise GroupNotFoundError(f"capability group '{name}' not found")
    if version:
        root = base / version
        if not (root / "group.json").is_file():
            raise GroupNotFoundError(
                f"capability group '{name}' version '{version}' not found"
            )
    else:
        versions = sorted(
            (p for p in base.iterdir() if (p / "group.json").is_file()),
            key=lambda p: _version_key(p.name),
        )
        if not versions:
            raise GroupNotFoundError(f"capability group '{name}' has no versions")
        root = versions[-1]

    data = read_json(root / "group.json")
    required = ("guid", "name", "version", "description")
    missing = [key for key in required if key not in data]
    if missing:
        raise VibeStackError(
            f"{root / 'group.json'} missing fields: {', '.join(missing)}"
        )
    if str(data["name"]) != name or str(data["version"]) != root.name:
        raise VibeStackError(
            f"{root / 'group.json'} name/version must match the directory"
        )
    return GroupMeta(
        guid=str(data["guid"]),
        name=str(data["name"]),
        version=str(data["version"]),
        description=str(data["description"]),
        permissions=_str_list(data.get("permissions")),
        extends=_str_list(data.get("extends")),
        tools=_str_list(data.get("tools")),
        tool_permissions=_str_map(data.get("tool_permissions")),
        root=root,
    )


def discover_groups(repo: Path) -> list[GroupMeta]:
    """Discover every ``capability-groups/<name>/<version>/group.json``."""
    base = repo / "capability-groups"
    if not base.is_dir():
        return []
    groups: list[GroupMeta] = []
    for config in sorted(base.glob("*/*/group.json")):
        try:
            groups.append(load_group(repo, config.parent.parent.name, config.parent.name))
        except VibeStackError:
            continue
    return groups


def load_tool(repo: Path, name: str, version: str) -> ToolMeta:
    """Load one ``tools/<name>/<version>/tool.json``."""
    root = repo / "tools" / name / version
    path = root / "tool.json"
    if not path.is_file():
        raise ToolNotFoundError(f"tool '{name}@{version}' not found")
    data = read_json(path)
    return ToolMeta(
        guid=str(data.get("guid", "")),
        name=str(data.get("name", name)),
        tool_name=str(data.get("tool_name", name)),
        version=str(data.get("version", version)),
        description=str(data.get("description", "")),
        provider=str(data.get("provider", "python")),
        permissions=_str_list(data.get("permissions")),
        entrypoint=_opt_str(data.get("entrypoint")),
        idempotent=bool(data.get("idempotent", True)),
        source=dict(data.get("source") or {}),
        run=dict(data["run"]) if isinstance(data.get("run"), dict) else None,
        mcp=dict(data["mcp"]) if isinstance(data.get("mcp"), dict) else None,
        root=root,
    )


def discover_tools(repo: Path) -> list[ToolMeta]:
    """Discover every tool package."""
    base = repo / "tools"
    if not base.is_dir():
        return []
    tools: list[ToolMeta] = []
    for config in sorted(base.glob("*/*/tool.json")):
        try:
            tools.append(load_tool(repo, config.parent.parent.name, config.parent.name))
        except VibeStackError:
            continue
    return tools


def find_tool(repo: Path, identifier: str) -> ToolMeta:
    """Find a tool by ``tool:<guid>@v<version>``, ``name@version``, name, or guid."""
    version = ""
    token = identifier
    if token.startswith("tool:"):
        token = token[5:]
    if "@v" in token:
        token, version = token.rsplit("@v", 1)
    elif "@" in token:
        token, version = token.rsplit("@", 1)

    candidates = discover_tools(repo)
    matches = [
        tool
        for tool in candidates
        if token in (tool.guid, tool.name, tool.tool_name) and (not version or tool.version == version)
    ]
    if not matches:
        raise ToolNotFoundError(f"tool '{identifier}' not found")
    matches.sort(key=lambda tool: _version_key(tool.version))
    return matches[-1]


def _str_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    return []


def _str_map(value: object) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        return {}
    return {str(key): _str_list(item) for key, item in value.items()}


def _opt_str(value: object) -> str | None:
    return str(value) if value is not None else None
