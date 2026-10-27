"""Read, write, and resolve ``.vibestack`` project stacks."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from vibe_stack.errors import (
    GroupAlreadyActiveError,
    GroupNotActiveError,
    ProjectConfigError,
    VibeStackError,
)
from vibe_stack.loader import discover_tools, load_group
from vibe_stack.model import GroupMeta, GroupRef, ProjectStack, ToolMeta
from vibe_stack.repo import default_core

_STACK_DIR = ".vibestack"
_STACK_FILE = "stack.json"
_LOCK_FILE = "lock.json"


def stack_dir(project_root: Path) -> Path:
    """Return the project's ``.vibestack`` directory."""
    return project_root / _STACK_DIR


def stack_path(project_root: Path) -> Path:
    """Return the project's ``.vibestack/stack.json`` path."""
    return stack_dir(project_root) / _STACK_FILE


def lock_path(project_root: Path) -> Path:
    """Return the project's ``.vibestack/lock.json`` path."""
    return stack_dir(project_root) / _LOCK_FILE


def read_stack(project_root: Path) -> ProjectStack | None:
    """Read the project stack, or ``None`` when no config exists."""
    path = stack_path(project_root)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except UnicodeDecodeError as exc:
        raise ProjectConfigError(f"invalid UTF-8 in {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ProjectConfigError(f"invalid JSON in {path}: {exc}") from exc
    except OSError as exc:
        raise ProjectConfigError(f"cannot read {path}: {exc}") from exc
    return ProjectStack.from_dict(data)


def write_stack(project_root: Path, stack: ProjectStack) -> Path:
    """Write ``stack.json`` atomically and return its path."""
    path = stack_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write(path, json.dumps(stack.to_dict(), ensure_ascii=False, indent=2) + "\n")
    return path


def init_stack(project_root: Path, core: GroupRef | None = None) -> ProjectStack:
    """Create ``.vibestack/stack.json`` when missing."""
    existing = read_stack(project_root)
    if existing is not None:
        return existing
    stack = ProjectStack(core=core or default_core())
    write_stack(project_root, stack)
    return stack


def parse_ref(value: str) -> GroupRef:
    """Parse ``name`` or ``name@version``."""
    if "@" in value:
        name, version = value.rsplit("@", 1)
    else:
        name, version = value, ""
    return GroupRef(name=name, version=version)


def activate(project_root: Path, ref: GroupRef, repo: Path | None = None) -> ProjectStack:
    """Append a capability group to the project stack."""
    stack = read_stack(project_root)
    if stack is None:
        stack = init_stack(project_root)
    if any(item.name == ref.name for item in stack.groups):
        raise GroupAlreadyActiveError(f"group '{ref.name}' is already active")
    repo_root = repo or _repo_for(project_root)
    group = load_group(repo_root, ref.name, ref.version or None)
    stack.groups.append(GroupRef(name=group.name, version=group.version))
    write_stack(project_root, stack)
    return stack


def deactivate(project_root: Path, name: str) -> ProjectStack:
    """Remove a capability group from the project stack."""
    stack = read_stack(project_root)
    if stack is None:
        raise ProjectConfigError(f"no {stack_path(project_root)}")
    kept = [item for item in stack.groups if item.name != name]
    if len(kept) == len(stack.groups):
        raise GroupNotActiveError(f"group '{name}' is not active")
    stack.groups = kept
    write_stack(project_root, stack)
    return stack


def resolve_order(
    repo: Path,
    stack: ProjectStack,
    *,
    strict: bool = True,
    warnings: list[str] | None = None,
) -> list[GroupMeta]:
    """Resolve core + project groups, dependencies first, deduplicated.

    ``strict`` controls missing groups. The CLI ``sync`` path stays strict;
    the plugin-facing resolve API skips missing groups and records warnings.
    """
    ordered: list[GroupMeta] = []
    seen: set[str] = set()
    refs = {ref.name: ref for ref in stack.groups}

    def add(name: str, version: str | None) -> None:
        if name in seen:
            return
        seen.add(name)
        try:
            group = load_group(repo, name, version or None)
        except VibeStackError as exc:
            if strict:
                raise
            if warnings is not None:
                warnings.append(str(exc))
            return
        for dependency in group.extends:
            ref = refs.get(dependency)
            add(dependency, ref.version if ref else None)
        ordered.append(group)

    if stack.core is not None:
        add(stack.core.name, stack.core.version)
    for ref in stack.groups:
        if ref.name == "core":
            continue
        add(ref.name, ref.version)
    return ordered


def missing_tools(repo: Path, groups: list[GroupMeta]) -> list[str]:
    """Return tool ids referenced by groups that are not installed."""
    available = {tool.id for tool in discover_tools(repo)}
    missing: list[str] = []
    for group in groups:
        for tool_id in group.tools:
            if tool_id not in available:
                missing.append(f"{group.name}: {tool_id}")
    return missing


def write_lock(
    repo: Path,
    project_root: Path,
    stack: ProjectStack,
    *,
    groups: list[GroupMeta] | None = None,
    fingerprint: str = "",
    warnings: list[str] | None = None,
) -> Path:
    """Write ``.vibestack/lock.json`` from an existing resolution or resolve it."""
    resolved_groups = list(groups) if groups is not None else resolve_order(repo, stack)
    data = {
        "schema_version": 1,
        "repository": str(repo.resolve()),
        "resolved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "core": None,
        "groups": [],
    }
    if stack.core is not None:
        core = next((g for g in resolved_groups if g.name == stack.core.name), None)
        if core is not None:
            data["core"] = _group_lock(core)
    data["groups"] = [
        _group_lock(group)
        for group in resolved_groups
        if stack.core is None or group.name != stack.core.name
    ]
    if fingerprint:
        data["fingerprint"] = fingerprint
    if warnings:
        data["warnings"] = list(warnings)
    path = lock_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    _atomic_write(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    return path


def _group_lock(group: GroupMeta) -> dict[str, object]:
    return {
        "name": group.name,
        "version": group.version,
        "path": group.root.as_posix(),
        "extends": list(group.extends),
        "tools": list(group.tools),
        "rules": [path.relative_to(group.root).as_posix() for path in group.rules],
        "agents": [path.name for path in group.agents],
        "commands": [path.name for path in group.commands],
        "skills": sorted(path.name for path in group.root.glob("skills/*")) if group.root.joinpath("skills").is_dir() else [],
    }


def tools_for_groups(repo: Path, groups: list[GroupMeta]) -> list[ToolMeta]:
    """Return deduplicated tool packages referenced by *groups*."""
    by_id = {tool.id: tool for tool in discover_tools(repo)}
    result: list[ToolMeta] = []
    seen: set[str] = set()
    for group in groups:
        for tool_id in group.tools:
            tool = by_id.get(tool_id)
            if tool is not None and tool.id not in seen:
                seen.add(tool.id)
                result.append(tool)
    return result


def _repo_for(project_root: Path) -> Path:
    from vibe_stack.repo import find_repo

    return find_repo()


def _atomic_write(path: Path, content: str) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(content, encoding="utf-8")
    temp.replace(path)
