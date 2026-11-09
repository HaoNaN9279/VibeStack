"""Data models for groups, tools, and project stacks."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from vibe_stack.errors import VibeStackError
from vibe_stack.model_layers import DEFAULT_MODEL_LAYER


@dataclass
class GroupRef:
    """Reference to one capability group version."""

    name: str
    version: str


@dataclass
class GroupMeta:
    """Metadata from ``group.json`` plus resolved paths."""

    guid: str
    name: str
    version: str
    description: str
    permissions: list[str] = field(default_factory=list)
    extends: list[str] = field(default_factory=list)
    tools: list[str] = field(default_factory=list)
    tool_permissions: dict[str, list[str]] = field(default_factory=dict)
    root: Path = field(default_factory=Path)

    @property
    def rules(self) -> list[Path]:
        if not (self.root / "rules").is_dir():
            return []
        return sorted((self.root / "rules").rglob("*.md"))

    @property
    def agents(self) -> list[Path]:
        return _md_files(self.root / "agents")

    @property
    def commands(self) -> list[Path]:
        return _md_files(self.root / "commands")

    @property
    def skills_dir(self) -> Path | None:
        path = self.root / "skills"
        return path if path.is_dir() else None

    @property
    def references(self) -> list[Path]:
        return _md_files(self.root / "references")


@dataclass
class ToolMeta:
    """Metadata from ``tool.json`` plus its package root."""

    guid: str
    name: str
    tool_name: str
    version: str
    description: str
    provider: str
    permissions: list[str] = field(default_factory=list)
    entrypoint: str | None = None
    idempotent: bool = True
    source: dict[str, object] = field(default_factory=dict)
    run: dict[str, object] | None = None
    mcp: dict[str, object] | None = None
    root: Path = field(default_factory=Path)

    @property
    def id(self) -> str:
        return f"tool:{self.guid}@v{self.version}"

    @property
    def short_id(self) -> str:
        return f"{self.name}@{self.version}"


@dataclass
class ResolvedGroup:
    """One capability group in a resolved injection plan."""

    guid: str
    name: str
    version: str
    description: str
    root: str
    permissions: list[str] = field(default_factory=list)
    extends: list[str] = field(default_factory=list)
    tools: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return {
            "guid": self.guid,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "root": self.root,
            "permissions": list(self.permissions),
            "extends": list(self.extends),
            "tools": list(self.tools),
        }


@dataclass
class ResolvedRule:
    """One validated rule file."""

    name: str
    path: str
    group: str

    def to_dict(self) -> dict[str, object]:
        return {"name": self.name, "path": self.path, "group": self.group}


@dataclass
class ResolvedSkill:
    """One validated skill directory."""

    name: str
    path: str
    group: str
    description: str = ""
    model: str | None = None

    def to_dict(self, include_model: bool = True) -> dict[str, object]:
        data: dict[str, object] = {
            "name": self.name,
            "path": self.path,
            "group": self.group,
            "description": self.description,
        }
        if include_model and self.model:
            data["model"] = self.model
        return data


@dataclass
class ResolvedAgent:
    """One validated agent definition."""

    name: str
    description: str
    mode: str
    system: str
    source: str
    group: str
    model: str | None = None

    def to_dict(self, include_model: bool = True) -> dict[str, object]:
        data: dict[str, object] = {
            "description": self.description,
            "mode": self.mode,
            "system": self.system,
            "source": self.source,
            "group": self.group,
        }
        if include_model and self.model:
            data["model"] = self.model
        return data


@dataclass
class ResolvedCommand:
    """One validated command definition."""

    name: str
    description: str
    template: str
    source: str
    group: str
    agent: str | None = None
    model: str | None = None

    def to_dict(self, include_model: bool = True) -> dict[str, object]:
        data: dict[str, object] = {
            "description": self.description,
            "template": self.template,
            "source": self.source,
            "group": self.group,
        }
        if self.agent:
            data["agent"] = self.agent
        if include_model and self.model:
            data["model"] = self.model
        return data


@dataclass
class ResolvedPlan:
    """Resolved, agent-agnostic injection plan."""

    schema_version: int
    active: bool
    mode: str
    repository: str
    project: str
    core: ResolvedGroup | None
    groups: list[ResolvedGroup]
    rules: list[ResolvedRule]
    skills: list[ResolvedSkill]
    agents: dict[str, ResolvedAgent]
    commands: dict[str, ResolvedCommand]
    mcp: dict[str, dict[str, object]]
    warnings: list[str]
    fingerprint: str
    model_layers: list[dict[str, object]] = field(default_factory=list)
    model_default: str = DEFAULT_MODEL_LAYER
    group_metas: list[GroupMeta] = field(default_factory=list, repr=False)

    def to_dict(self, api_version: int = 2) -> dict[str, object]:
        """Serialize the plan for one resolve API version.

        v1 is the pre-mode/pre-model shape; v2 adds ``mode``, the optional
        ``model`` field on agents, commands, and skills, and the platform model
        layer catalog.
        """
        include_model = api_version >= 2
        data: dict[str, object] = {
            "schema_version": api_version,
            "active": self.active,
            "repository": self.repository,
            "project": self.project,
            "core": self.core.to_dict() if self.core is not None else None,
            "groups": [group.to_dict() for group in self.groups],
            "rules": [rule.to_dict() for rule in self.rules],
            "skills": [skill.to_dict(include_model) for skill in self.skills],
            "agents": {
                name: agent.to_dict(include_model)
                for name, agent in self.agents.items()
            },
            "commands": {
                name: command.to_dict(include_model)
                for name, command in self.commands.items()
            },
            "mcp": dict(self.mcp),
            "warnings": list(self.warnings),
            "fingerprint": self.fingerprint,
        }
        if api_version >= 2:
            data["mode"] = self.mode
            data["model_layers"] = [dict(layer) for layer in self.model_layers]
            data["model_default"] = self.model_default
        return data


@dataclass
class ProjectStack:
    """Contents of ``.vibestack/stack.json``."""

    schema_version: int = 1
    core: GroupRef | None = None
    agents: list[str] = field(default_factory=list)
    groups: list[GroupRef] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        data: dict[str, object] = {
            "schema_version": self.schema_version,
            "agents": list(self.agents),
            "groups": [
                {"name": ref.name, "version": ref.version} for ref in self.groups
            ],
        }
        if self.core is not None:
            data["core"] = {"name": self.core.name, "version": self.core.version}
        return data

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> ProjectStack:
        if not isinstance(data, dict):
            raise VibeStackError("stack.json must be a JSON object")
        schema = data.get("schema_version", 1)
        if schema != 1:
            raise VibeStackError(f"unsupported stack schema_version: {schema}")
        core_data = data.get("core")
        core = None
        if isinstance(core_data, dict):
            core = GroupRef(
                name=str(core_data.get("name", "core")),
                version=str(core_data.get("version", "0.1.0")),
            )
        groups: list[GroupRef] = []
        raw_groups = data.get("groups", [])
        if not isinstance(raw_groups, list):
            raise VibeStackError("stack.json 'groups' must be an array")
        for item in raw_groups:
            if not isinstance(item, dict) or not item.get("name"):
                raise VibeStackError("stack.json group entries need a name")
            groups.append(
                GroupRef(
                    name=str(item["name"]),
                    version=str(item.get("version", "")),
                )
            )
        agents = data.get("agents", [])
        return cls(
            schema_version=1,
            core=core,
            agents=[str(item) for item in agents] if isinstance(agents, list) else [],
            groups=groups,
        )


def _md_files(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(directory.glob("*.md"))


def read_json(path: Path) -> dict[str, object]:
    """Read a JSON object from *path*."""
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError as exc:
        raise VibeStackError(f"missing file: {path}") from exc
    except UnicodeDecodeError as exc:
        raise VibeStackError(f"invalid UTF-8 in {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise VibeStackError(f"invalid JSON in {path}: {exc}") from exc
    except OSError as exc:
        raise VibeStackError(f"cannot read {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise VibeStackError(f"{path} must contain a JSON object")
    return data
