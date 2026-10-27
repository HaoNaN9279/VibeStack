"""Resolve project stacks into agent-agnostic injection plans."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

from vibe_stack.frontmatter import frontmatter_text, parse_frontmatter
from vibe_stack.loader import discover_tools
from vibe_stack.model import (
    GroupMeta,
    ProjectStack,
    ResolvedAgent,
    ResolvedCommand,
    ResolvedGroup,
    ResolvedPlan,
    ResolvedRule,
    ResolvedSkill,
    ToolMeta,
)
from vibe_stack.project import read_stack, resolve_order

SCHEMA_VERSION = 1
_AGENT_MODES = {"primary", "subagent", "all"}
_SKILL_NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_T = TypeVar("_T")


def resolve_project(repo: Path, project: Path) -> ResolvedPlan:
    """Read a project's stack and build a fail-open injection plan."""
    stack = read_stack(project)
    return build_plan(repo, project, stack, strict=False)


def build_plan(
    repo: Path,
    project: Path,
    stack: ProjectStack | None,
    *,
    strict: bool = False,
) -> ResolvedPlan:
    """Build a resolved plan from an already-loaded stack."""
    warnings: list[str] = []
    if stack is None:
        return ResolvedPlan(
            schema_version=SCHEMA_VERSION,
            active=False,
            repository=_posix(repo),
            project=_posix(project),
            core=None,
            groups=[],
            rules=[],
            skills=[],
            agents={},
            commands={},
            mcp={},
            warnings=warnings,
            fingerprint=_fingerprint(repo, None, [], {}),
        )

    groups = resolve_order(repo, stack, strict=strict, warnings=warnings)
    core_name = stack.core.name if stack.core is not None else ""
    core_meta = next((group for group in groups if group.name == core_name), None)
    content = _collect_content(repo, groups, warnings)
    return ResolvedPlan(
        schema_version=SCHEMA_VERSION,
        active=True,
        repository=_posix(repo),
        project=_posix(project),
        core=_group_summary(core_meta) if core_meta is not None else None,
        groups=[
            _group_summary(group)
            for group in groups
            if core_meta is None or group.name != core_meta.name
        ],
        rules=content["rules"],
        skills=content["skills"],
        agents=content["agents"],
        commands=content["commands"],
        mcp=content["mcp"],
        warnings=warnings,
        fingerprint=_fingerprint(repo, stack, groups, content["tools"]),
        group_metas=groups,
    )


def _collect_content(
    repo: Path, groups: list[GroupMeta], warnings: list[str]
) -> dict[str, object]:
    tools = _tool_index(repo)
    used_tools: dict[str, ToolMeta] = {}
    rules: list[ResolvedRule] = []
    skills: list[ResolvedSkill] = []
    agents: dict[str, ResolvedAgent] = {}
    commands: dict[str, ResolvedCommand] = {}
    mcp: dict[str, dict[str, object]] = {}

    for group in groups:
        for file in group.rules:
            parsed = _read_frontmatter(file, warnings)
            if parsed is None:
                continue
            name = frontmatter_text(parsed.data.get("name"))
            if not name:
                warnings.append(f"rule {file.name} missing required frontmatter: name")
                continue
            rules.append(ResolvedRule(name=name, path=_posix(file), group=group.name))

        for directory in _skill_dirs(group.root / "skills"):
            _collect_skill(directory, group, skills, warnings)

        for file in group.agents:
            parsed = _read_frontmatter(file, warnings)
            if parsed is None:
                continue
            name = frontmatter_text(parsed.data.get("name"))
            description = frontmatter_text(parsed.data.get("description"))
            mode = frontmatter_text(parsed.data.get("mode"))
            missing = [
                key
                for key, value in (
                    ("name", name),
                    ("description", description),
                    ("mode", mode),
                )
                if not value
            ]
            if missing:
                warnings.append(
                    f"agent {file.name} missing required frontmatter: {', '.join(missing)}"
                )
                continue
            if mode not in _AGENT_MODES:
                warnings.append(f"agent {file.name} has invalid mode: {mode}")
                continue
            agents[name] = ResolvedAgent(
                name=name,
                description=description,
                mode=mode,
                system=parsed.body,
                source=_posix(file),
                group=group.name,
            )

        for file in group.commands:
            parsed = _read_frontmatter(file, warnings)
            if parsed is None:
                continue
            name = frontmatter_text(parsed.data.get("name"))
            description = frontmatter_text(parsed.data.get("description"))
            missing = [
                key
                for key, value in (("name", name), ("description", description))
                if not value
            ]
            if missing:
                warnings.append(
                    f"command {file.name} missing required frontmatter: {', '.join(missing)}"
                )
                continue
            commands[name] = ResolvedCommand(
                name=name,
                description=description,
                agent=frontmatter_text(parsed.data.get("agent")) or None,
                template=parsed.body,
                source=_posix(file),
                group=group.name,
            )

        for tool_id in group.tools:
            tool = tools.get(tool_id)
            if tool is None:
                warnings.append(f"tool not found for {group.name}: {tool_id}")
                continue
            used_tools[tool.id] = tool
            if not isinstance(tool.mcp, dict):
                continue
            server = tool.mcp
            if server.get("enabled") is False:
                continue
            server_name = str(server.get("name") or tool.name)
            key = f"vibe:{group.name}_{server_name}"
            mcp[key] = {
                str(name): value for name, value in server.items() if name != "name"
            }

    return {
        "rules": _unique(rules, lambda item: item.path),
        "skills": _unique(skills, lambda item: item.path),
        "agents": agents,
        "commands": commands,
        "mcp": mcp,
        "tools": used_tools,
    }


def _collect_skill(
    directory: Path,
    group: GroupMeta,
    skills: list[ResolvedSkill],
    warnings: list[str],
) -> None:
    file = directory / "SKILL.md"
    parsed = _read_frontmatter(file, warnings)
    if parsed is None:
        return
    name = frontmatter_text(parsed.data.get("name"))
    description = frontmatter_text(parsed.data.get("description"))
    missing = [
        key
        for key, value in (("name", name), ("description", description))
        if not value
    ]
    if missing:
        warnings.append(
            f"skill {directory.name} missing required frontmatter: {', '.join(missing)}"
        )
        return
    if len(name) > 64 or _SKILL_NAME.match(name) is None:
        warnings.append(f"skill {directory.name} has invalid name: {name}")
        return
    if name != directory.name:
        warnings.append(
            f"skill {directory.name} name does not match directory: {name}"
        )
        return
    if "metadata" in parsed.data:
        warnings.append(f"skill {directory.name} must not define metadata")
        return
    if len(description) > 1024:
        warnings.append(
            f"skill {directory.name} description exceeds 1024 characters"
        )
        return
    skills.append(
        ResolvedSkill(
            name=name,
            path=_posix(directory),
            group=group.name,
            description=description,
        )
    )


def _read_frontmatter(path: Path, warnings: list[str]):
    try:
        text = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        warnings.append(f"cannot read {path.name}: {exc}")
        return None
    return parse_frontmatter(text)


def _skill_dirs(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    found: list[Path] = []

    def walk(directory: Path, depth: int) -> None:
        try:
            entries = sorted(directory.iterdir(), key=lambda path: path.name)
        except OSError:
            return
        if any(entry.is_file() and entry.name == "SKILL.md" for entry in entries):
            found.append(directory)
            return
        if depth >= 6:
            return
        for entry in entries:
            if entry.is_dir() and not entry.name.startswith("."):
                walk(entry, depth + 1)

    walk(root, 0)
    return sorted(found)


def _tool_index(repo: Path) -> dict[str, ToolMeta]:
    index: dict[str, ToolMeta] = {}
    for tool in discover_tools(repo):
        index[tool.id] = tool
        index[tool.short_id] = tool
    return index


def _group_summary(group: GroupMeta) -> ResolvedGroup:
    return ResolvedGroup(
        guid=group.guid,
        name=group.name,
        version=group.version,
        description=group.description,
        root=_posix(group.root),
        permissions=list(group.permissions),
        extends=list(group.extends),
        tools=list(group.tools),
    )


def _fingerprint(
    repo: Path,
    stack: ProjectStack | None,
    groups: list[GroupMeta],
    tools: dict[str, ToolMeta],
) -> str:
    digest = hashlib.sha256()
    digest.update(f"vibestack-resolve-v{SCHEMA_VERSION}\0".encode("utf-8"))
    if stack is not None:
        digest.update(
            json.dumps(
                stack.to_dict(), sort_keys=True, ensure_ascii=False
            ).encode("utf-8")
        )
    for group in groups:
        digest.update(f"group:{group.name}@{group.version}\0".encode("utf-8"))
        _hash_file(digest, group.root / "group.json", repo)
        files = [*group.rules, *group.agents, *group.commands]
        files.extend(
            directory / "SKILL.md"
            for directory in _skill_dirs(group.root / "skills")
        )
        for file in sorted(set(files)):
            _hash_file(digest, file, repo)
    for tool in sorted(tools.values(), key=lambda item: item.id):
        _hash_file(digest, tool.root / "tool.json", repo)
    return digest.hexdigest()


def _hash_file(digest: "hashlib._Hash", path: Path, repo: Path) -> None:
    try:
        content = path.read_bytes()
    except OSError:
        return
    try:
        relative = path.relative_to(repo).as_posix()
    except ValueError:
        relative = path.name
    digest.update(relative.encode("utf-8"))
    digest.update(b"\0")
    digest.update(content)
    digest.update(b"\0")


def _unique(items: list[_T], key: Callable[[_T], str]) -> list[_T]:
    seen: set[str] = set()
    result: list[_T] = []
    for item in items:
        value = key(item)
        if value in seen:
            continue
        seen.add(value)
        result.append(item)
    return result


def _posix(path: Path) -> str:
    return path.resolve().as_posix()
