"""Simulate the content one VibeStack session loads.

The view is a pure computation over a resolved plan: it never reads a session
log, never runs hooks and never writes anything. Section order and item order
mirror the plugin's assembly order, so the CLI and the DSH panel show the same
sequence the model would receive:

1. persona - the agent system prompt section
2. skills - the skill catalog built at turn start
3. commands - the command registry synced in `agent/pre-step`
4. mcp - mounted MCP servers
5. rules - the workspace-instructions message appended last

Inside the rules section the items are ordered exactly like the rendered
message: injected bodies first, then index-only lines, then the rules dropped
by the byte budget. Rules that do not apply to the working directory are not
loaded at all and travel in a separate trailing section.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from vibe_stack.errors import VibeStackError
from vibe_stack.model import (
    ResolvedAgent,
    ResolvedCommand,
    ResolvedPlan,
    ResolvedSkill,
)
from vibe_stack.resolve import resolve_project
from vibe_stack.rules import (
    DEFAULT_RULES_BYTES,
    RuleBlock,
    normalize_path,
    plan_rules,
    read_body,
    relative_to,
)

SUMMARY_LIMIT = 200
DEFAULT_TEXT_BYTES = 65536

SECTION_TITLES = {
    "persona": "Agent 人设",
    "skills": "技能",
    "commands": "命令",
    "mcp": "MCP 工具",
    "rules": "规则",
    "rules-skipped": "未加载规则（当前目录不匹配）",
    "agents": "人设候选（仅界面）",
}


@dataclass
class SessionItem:
    """One loaded (or explicitly not loaded) piece of content."""

    kind: str
    id: str
    name: str
    group: str
    module: str = ""
    scope: str = ""
    status: str = "active"
    bytes: int = 0
    path: str = ""
    description: str = ""
    summary: str = ""
    host_name: str = ""
    current: bool = False
    text: str | None = None
    truncated: bool = False

    def to_dict(self) -> dict[str, object]:
        data: dict[str, object] = {
            "kind": self.kind,
            "id": self.id,
            "name": self.name,
            "group": self.group,
            "module": self.module,
            "scope": self.scope,
            "status": self.status,
            "bytes": self.bytes,
            "path": self.path,
            "description": self.description,
            "summary": self.summary,
        }
        if self.host_name:
            data["host_name"] = self.host_name
        if self.current:
            data["current"] = True
        if self.text is not None:
            data["text"] = self.text
            data["truncated"] = self.truncated
        return data


@dataclass
class SessionSection:
    """One ordered group of content."""

    kind: str
    items: list[SessionItem] = field(default_factory=list)
    collapsed: bool = False

    @property
    def title(self) -> str:
        return SECTION_TITLES.get(self.kind, self.kind)

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "title": self.title,
            "collapsed": self.collapsed,
            "items": [item.to_dict() for item in self.items],
        }


@dataclass
class SessionView:
    """Everything one simulated session would load."""

    project: str
    cwd: str
    mode: str
    agent: dict[str, object]
    model: dict[str, object]
    sections: list[SessionSection]
    budget: dict[str, object]
    warnings: list[str]
    fingerprint: str

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": 1,
            "project": self.project,
            "cwd": self.cwd,
            "mode": self.mode,
            "agent": self.agent,
            "model": self.model,
            "sections": [section.to_dict() for section in self.sections],
            "budget": self.budget,
            "warnings": list(self.warnings),
            "fingerprint": self.fingerprint,
        }


def build_session(
    repo: Path,
    project: Path,
    *,
    agent_name: str | None = None,
    cwd: str | None = None,
    mode: str = "project",
    max_rules_bytes: int = DEFAULT_RULES_BYTES,
    with_text: bool = False,
    text_bytes: int = DEFAULT_TEXT_BYTES,
) -> SessionView:
    """Compute the content a session at *cwd* would load for *agent_name*."""
    plan = resolve_project(repo, project, mode=mode)
    relative = _normalize_cwd(project, cwd)
    agent = _select_agent(plan, agent_name)
    limit = max_rules_bytes if max_rules_bytes > 0 else DEFAULT_RULES_BYTES
    text_limit = text_bytes if text_bytes > 0 else DEFAULT_TEXT_BYTES

    rules_section, skipped_section, budget = _collect_rules(
        plan, relative, limit, with_text, text_limit
    )
    sections = [
        SessionSection("persona", [_persona_item(agent, with_text, text_limit)]),
        SessionSection("skills", _skill_items(plan, with_text, text_limit)),
        SessionSection("commands", _command_items(plan, with_text, text_limit)),
        SessionSection("mcp", _mcp_items(plan)),
        rules_section,
    ]
    if skipped_section.items:
        sections.append(skipped_section)
    sections.append(SessionSection("agents", _agent_items(plan, agent), collapsed=True))

    return SessionView(
        project=str(plan.project),
        cwd=relative,
        mode=plan.mode,
        agent=_agent_payload(agent),
        model={
            "default": plan.model_default,
            "agent": agent.model,
            "catalog": [str(layer.get("id")) for layer in plan.model_layers],
        },
        sections=sections,
        budget=budget,
        warnings=list(plan.warnings),
        fingerprint=plan.fingerprint,
    )


def _normalize_cwd(project: Path, cwd: str | None) -> str:
    if cwd is None or cwd in ("", "."):
        return ""
    candidate = Path(cwd)
    if candidate.is_absolute():
        return normalize_path(relative_to(project, candidate))
    return normalize_path(cwd)


def _select_agent(plan: ResolvedPlan, agent_name: str | None) -> ResolvedAgent:
    agents = list(plan.agents.values())
    if not agents:
        raise VibeStackError("no agents in the resolved plan")
    if agent_name is None or agent_name == "":
        for candidate in agents:
            if candidate.mode != "subagent":
                return candidate
        return agents[0]
    exact = [item for item in agents if item.name == agent_name]
    if exact:
        return exact[0]
    folded = [item for item in agents if item.name.lower() == agent_name.lower()]
    if folded:
        return folded[0]
    known = ", ".join(sorted(item.name for item in agents))
    raise VibeStackError(f"unknown agent: {agent_name} (available: {known})")


def _agent_payload(agent: ResolvedAgent) -> dict[str, object]:
    return {
        "name": agent.name,
        "id": agent.id,
        "group": agent.group,
        "module": agent.module,
        "description": agent.description,
        "model": agent.model,
        "system_path": agent.system_path,
        "label": agent.label,
    }


def _persona_item(
    agent: ResolvedAgent, with_text: bool, text_limit: int
) -> SessionItem:
    system = agent.system
    text, truncated = _clip(system, text_limit) if with_text else (None, False)
    return SessionItem(
        kind="persona",
        id=agent.id or agent.name,
        name=agent.name,
        group=agent.group,
        module=agent.module,
        status="active",
        bytes=_size(system),
        path=agent.system_path or agent.source,
        description=agent.description,
        summary=_summary(system, agent.description),
        current=True,
        text=text,
        truncated=truncated,
    )


def _agent_items(plan: ResolvedPlan, current: ResolvedAgent) -> list[SessionItem]:
    items: list[SessionItem] = []
    for agent in plan.agents.values():
        items.append(
            SessionItem(
                kind="agent",
                id=agent.id or agent.name,
                name=agent.name,
                group=agent.group,
                module=agent.module,
                status="active",
                bytes=_size(agent.system),
                path=agent.system_path or agent.source,
                description=agent.description,
                summary=agent.description or agent.mode,
                current=agent is current,
            )
        )
    return items


def _skill_items(
    plan: ResolvedPlan, with_text: bool, text_limit: int
) -> list[SessionItem]:
    return [_skill_item(plan, skill, with_text, text_limit) for skill in plan.skills]


def _skill_item(
    plan: ResolvedPlan,
    skill: ResolvedSkill,
    with_text: bool,
    text_limit: int,
) -> SessionItem:
    file = str(Path(skill.path) / "SKILL.md")
    body = read_body(file)
    text, truncated = (
        _clip(body, text_limit) if with_text and body is not None else (None, False)
    )
    host = skill.host or str(plan.names.get("skills", {}).get(skill.id, ""))
    return SessionItem(
        kind="skill",
        id=skill.id or skill.name,
        name=skill.name,
        group=skill.group,
        module=skill.module,
        status="active",
        bytes=_size(body or ""),
        path=file,
        description=skill.description,
        summary=skill.description or _summary(body or ""),
        host_name=host,
        text=text,
        truncated=truncated,
    )


def _command_items(
    plan: ResolvedPlan, with_text: bool, text_limit: int
) -> list[SessionItem]:
    return [
        _command_item(plan, command, with_text, text_limit)
        for command in plan.commands.values()
    ]


def _command_item(
    plan: ResolvedPlan,
    command: ResolvedCommand,
    with_text: bool,
    text_limit: int,
) -> SessionItem:
    body = (
        read_body(command.template_path)
        if command.template_path
        else command.template
    )
    text, truncated = (
        _clip(body, text_limit) if with_text and body is not None else (None, False)
    )
    host = str(plan.names.get("commands", {}).get(command.id, ""))
    return SessionItem(
        kind="command",
        id=command.id or command.name,
        name=command.name,
        group=command.group,
        module=command.module,
        status="active",
        bytes=_size(body or ""),
        path=command.template_path or command.source,
        description=command.description,
        summary=command.description or _summary(body or ""),
        host_name=host,
        text=text,
        truncated=truncated,
    )


def _mcp_items(plan: ResolvedPlan) -> list[SessionItem]:
    items: list[SessionItem] = []
    for key, entry in plan.mcp.items():
        data = entry if isinstance(entry, dict) else {}
        transport = str(data.get("type", ""))
        command = data.get("command")
        if isinstance(command, list):
            detail = " ".join(str(part) for part in command)
        else:
            detail = str(data.get("url", "") or "")
        group, module, server = _mcp_owner(plan, key)
        items.append(
            SessionItem(
                kind="mcp",
                id=key,
                name=server or key,
                group=group,
                module=module,
                status="active",
                bytes=0,
                description=transport,
                summary=f"{transport}: {detail}".strip(": "),
                host_name=key,
            )
        )
    return items


def _mcp_owner(plan: ResolvedPlan, key: str) -> tuple[str, str, str]:
    """Recover group, module alias and server name from a mount key."""
    raw = key[len("vibe:") :] if key.startswith("vibe:") else key
    groups = [*([plan.core] if plan.core is not None else []), *plan.groups]
    for group in groups:
        prefix = f"{group.name}_"
        if not raw.startswith(prefix):
            continue
        rest = raw[len(prefix) :]
        for module in group.modules:
            alias = str(module.get("alias") or "")
            if alias and rest.startswith(f"{alias}_"):
                return group.name, alias, rest[len(alias) + 1 :]
        return group.name, "", rest
    return "", "", raw


def _collect_rules(
    plan: ResolvedPlan,
    relative: str,
    max_bytes: int,
    with_text: bool,
    text_limit: int,
) -> tuple[SessionSection, SessionSection, dict[str, object]]:
    planned = plan_rules(plan, relative, max_bytes=max_bytes)
    items = [
        _rule_item(block, with_text, text_limit)
        for block in [*planned.injected, *planned.indexed, *planned.omitted]
    ]
    skipped_items = [
        SessionItem(
            kind="rule",
            id=rule.id or rule.name,
            name=rule.name,
            group=rule.group,
            module=rule.module,
            scope=rule.scope,
            status="skipped",
            bytes=_size(read_body(rule.path) or ""),
            path=rule.path,
            description=rule.description,
            summary=rule.description or _summary(read_body(rule.path) or "", rule.name),
        )
        for rule in planned.skipped
    ]
    used = planned.used if planned.text is not None else 0
    budget = {
        "limit": planned.limit,
        "used": used,
        "omitted": len(planned.omitted),
    }
    return (
        SessionSection("rules", items),
        SessionSection("rules-skipped", skipped_items, collapsed=True),
        budget,
    )


def _rule_item(block: RuleBlock, with_text: bool, text_limit: int) -> SessionItem:
    rule = block.rule
    body = block.body or read_body(rule.path) or ""
    text, truncated = _clip(body, text_limit) if with_text else (None, False)
    return SessionItem(
        kind="rule",
        id=rule.id or rule.name,
        name=rule.name,
        group=rule.group,
        module=rule.module,
        scope=rule.scope,
        status=block.status,
        bytes=block.bytes or _size(body),
        path=rule.path,
        description=rule.description,
        summary=rule.description or _summary(body, rule.name),
        text=text,
        truncated=truncated,
    )


def _summary(body: str, fallback: str = "") -> str:
    for line in body.splitlines():
        text = line.strip().lstrip("#").strip()
        if not text:
            continue
        return text[:SUMMARY_LIMIT]
    return fallback[:SUMMARY_LIMIT]


def _clip(text: str, limit: int) -> tuple[str, bool]:
    encoded = text.encode("utf-8")
    if len(encoded) <= limit:
        return text, False
    return encoded[:limit].decode("utf-8", "ignore"), True


def _size(text: str) -> int:
    return len(text.encode("utf-8"))


def dumps(view: SessionView) -> str:
    """Compact JSON for the CLI ``--json`` surface."""
    return json.dumps(view.to_dict(), ensure_ascii=False, separators=(",", ":"))
