"""Command line interface for VibeStack."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from vibe_stack import __version__
from vibe_stack.bindings import (
    DEFAULT_AGENT,
    bind_layer,
    catalog_document,
    migrate_legacy,
    models_summary,
    set_default_layer,
    unbind_layer,
)
from vibe_stack.errors import VibeStackError
from vibe_stack.loader import discover_groups, discover_tools, load_group
from vibe_stack.plugin import discover_plugins, status as plugin_status
from vibe_stack.project import (
    activate,
    deactivate,
    init_stack,
    lock_path,
    missing_tools,
    parse_ref,
    read_stack,
    stack_path,
    tools_for_groups,
    write_lock,
)
from vibe_stack.repo import find_repo, write_global_config, read_global_config, default_core
from vibe_stack.resolve import (
    MODE_PROJECT,
    MODE_VIBESTACK,
    build_plan,
    resolve_project,
)
from vibe_stack.tools import exec_in_tool, run_tool


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
    parser = argparse.ArgumentParser(
        prog="vibe-stack",
        description="Capability groups and tools for AI agent tools",
    )
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--repo", type=Path, help="VibeStack repository root")
    parser.add_argument(
        "--project",
        type=Path,
        default=Path.cwd(),
        help="project root containing .vibestack (default: cwd)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="list capability groups and tools")
    sub.add_parser("status", help="show project capability groups")
    sub.add_parser("sync", help="resolve the project stack and write lock.json")

    resolve_parser = sub.add_parser(
        "resolve", help="resolve the project stack into an injection plan"
    )
    resolve_parser.add_argument(
        "--json", action="store_true", help="write the plan as JSON"
    )
    resolve_parser.add_argument(
        "--project",
        dest="resolve_project",
        type=Path,
        default=None,
        help="project root containing .vibestack",
    )
    resolve_parser.add_argument(
        "--repo",
        dest="resolve_repo",
        type=Path,
        default=None,
        help="VibeStack repository root",
    )
    resolve_parser.add_argument(
        "--mode",
        choices=(MODE_PROJECT, MODE_VIBESTACK),
        default=MODE_PROJECT,
        help=(
            "project: historical behavior (no stack means no Core); "
            "vibestack: keep Core loaded in every workspace (DSH mode)"
        ),
    )
    resolve_parser.add_argument(
        "--api-version",
        dest="api_version",
        type=int,
        choices=(1, 2),
        default=2,
        help="resolve plan schema version (1: pre-mode/pre-model; 2: current)",
    )

    init = sub.add_parser("init", help="create .vibestack/stack.json")
    init.add_argument("--core", default="", help="core group as name@version")

    info = sub.add_parser("info", help="show capability group details")
    info.add_argument("group")
    info.add_argument("--group-version", default="")

    activate_parser = sub.add_parser("activate", help="activate capability groups")
    activate_parser.add_argument("groups", nargs="+", metavar="group[@version]")

    deactivate_parser = sub.add_parser("deactivate", help="deactivate capability groups")
    deactivate_parser.add_argument("groups", nargs="+")

    tool = sub.add_parser("tool", help="tool packages")
    tool_sub = tool.add_subparsers(dest="tool_command", required=True)
    tool_sub.add_parser("list", help="list tool packages")
    run = tool_sub.add_parser("run", help="run a tool CLI")
    run.add_argument("tool")
    run.add_argument("args", nargs=argparse.REMAINDER)
    serve = tool_sub.add_parser("serve", help="start a tool MCP server")
    serve.add_argument("tool")
    serve.add_argument("args", nargs=argparse.REMAINDER)
    execute = tool_sub.add_parser("exec", help="run a command in a tool environment")
    execute.add_argument("tool")
    execute.add_argument("args", nargs=argparse.REMAINDER)

    plugin = sub.add_parser("plugin", help="agent plugin adapters")
    plugin_sub = plugin.add_subparsers(dest="plugin_command", required=True)
    plugin_sub.add_parser("list", help="list adapters")
    plugin_status_parser = plugin_sub.add_parser("status", help="adapter status")
    plugin_status_parser.add_argument("agent")

    models = sub.add_parser("models", help="platform model layers and local bindings")
    models_sub = models.add_subparsers(dest="models_command", required=True)
    catalog = models_sub.add_parser("catalog", help="print the platform layer catalog")
    catalog.add_argument("--json", action="store_true", help="write JSON")
    show = models_sub.add_parser("show", help="print layers with local bindings")
    show.add_argument("--agent", default=DEFAULT_AGENT, help="adapter name (default: dsh)")
    show.add_argument("--json", action="store_true", help="write JSON")
    bind = models_sub.add_parser("bind", help="bind one layer to a host route")
    bind.add_argument("layer")
    bind.add_argument("--agent", default=DEFAULT_AGENT, help="adapter name (default: dsh)")
    bind.add_argument("--provider", required=True)
    bind.add_argument("--model", required=True)
    bind.add_argument("--effort", default="", help="optional reasoning effort")
    unbind = models_sub.add_parser("unbind", help="remove one layer binding")
    unbind.add_argument("layer")
    unbind.add_argument("--agent", default=DEFAULT_AGENT, help="adapter name (default: dsh)")
    default = models_sub.add_parser("default", help="set or clear the default layer")
    default.add_argument("layer", help="layer id or 'none'")
    default.add_argument("--agent", default=DEFAULT_AGENT, help="adapter name (default: dsh)")
    migrate = models_sub.add_parser("migrate", help="convert legacy models.layers")
    migrate.add_argument("--agent", default=DEFAULT_AGENT, help="adapter name (default: dsh)")

    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "models":
            return _models(args)
        repo = find_repo(getattr(args, "resolve_repo", None) or args.repo)
        if getattr(args, "resolve_project", None) is not None:
            args.project = args.resolve_project
        return _dispatch(args, repo)
    except VibeStackError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


def _dispatch(args: argparse.Namespace, repo: Path) -> int:
    project = args.project.resolve()
    if args.command == "list":
        return _list(repo)
    if args.command == "status":
        return _status(project)
    if args.command == "init":
        return _init(repo, project, args.core)
    if args.command == "info":
        return _info(repo, args.group, args.group_version)
    if args.command == "activate":
        return _activate(repo, project, args.groups)
    if args.command == "deactivate":
        return _deactivate(project, args.groups)
    if args.command == "sync":
        return _sync(repo, project)
    if args.command == "resolve":
        return _resolve(
            repo,
            project,
            bool(getattr(args, "json", False)),
            str(getattr(args, "mode", MODE_PROJECT)),
            int(getattr(args, "api_version", 2)),
        )
    if args.command == "tool":
        return _tool(repo, args)
    if args.command == "plugin":
        return _plugin(repo, args)
    raise VibeStackError(f"unknown command: {args.command}")


def _list(repo: Path) -> int:
    groups = discover_groups(repo)
    print("Capability groups:")
    for group in groups:
        print(f"  {group.name}@{group.version}  {group.description}")
    tools = discover_tools(repo)
    print("\nTools:")
    for tool in tools:
        print(f"  {tool.short_id}  [{tool.provider}]  {tool.description}")
    return 0


def _status(project: Path) -> int:
    stack = read_stack(project)
    if stack is None:
        print(f"no {stack_path(project)}")
        return 0
    if stack.core:
        print(f"core: {stack.core.name}@{stack.core.version}")
    if not stack.groups:
        print("groups: (none)")
    else:
        print("groups:")
        for ref in stack.groups:
            print(f"  {ref.name}@{ref.version}")
    if lock_path(project).is_file():
        print(f"lock: {lock_path(project)}")
    return 0


def _init(repo: Path, project: Path, core_value: str) -> int:
    core = parse_ref(core_value) if core_value else default_core()
    stack = init_stack(project, core)
    config = read_global_config()
    config["schema_version"] = 1
    config["repository"] = str(repo.resolve())
    config["core"] = {"name": core.name, "version": core.version}
    write_global_config(config)
    path = stack_path(project)
    print(f"created {path}")
    if stack.groups:
        print(f"existing groups: {len(stack.groups)}")
    return 0


def _info(repo: Path, name: str, version: str) -> int:
    group = load_group(repo, name, version or None)
    print(f"{group.name}@{group.version}")
    print(f"guid: {group.guid}")
    print(f"description: {group.description}")
    print(f"extends: {', '.join(group.extends) or '(none)'}")
    print(f"tools: {', '.join(group.tools) or '(none)'}")
    print(f"rules: {len(group.rules)}")
    print(f"agents: {len(group.agents)}")
    print(f"commands: {len(group.commands)}")
    print(f"skills: {len(list((group.root / 'skills').glob('*'))) if (group.root / 'skills').is_dir() else 0}")
    print(f"path: {group.root}")
    return 0


def _activate(repo: Path, project: Path, values: list[str]) -> int:
    config = read_global_config()
    config["schema_version"] = 1
    config["repository"] = str(repo.resolve())
    write_global_config(config)
    for value in values:
        ref = parse_ref(value)
        stack = activate(project, ref, repo)
        group = load_group(repo, ref.name, ref.version or None)
        missing = missing_tools(repo, [group])
        print(f"activated {group.name}@{group.version}")
        for item in missing:
            print(f"  warning: missing tool {item}", file=sys.stderr)
        print(f"  stack: {stack_path(project)} ({len(stack.groups)} groups)")
    return 0


def _deactivate(project: Path, values: list[str]) -> int:
    for name in values:
        stack = deactivate(project, name)
        print(f"deactivated {name} ({len(stack.groups)} groups)")
    return 0


def _sync(repo: Path, project: Path) -> int:
    stack = read_stack(project)
    if stack is None:
        raise VibeStackError(f"no {stack_path(project)}; run `vibe-stack init`")
    plan = build_plan(repo, project, stack, strict=True)
    groups = plan.group_metas
    missing = missing_tools(repo, groups)
    path = write_lock(
        repo,
        project,
        stack,
        groups=groups,
        fingerprint=plan.fingerprint,
        warnings=plan.warnings,
    )
    print(f"resolved {len(groups)} groups")
    print(f"lock: {path}")
    print(f"tools: {len(tools_for_groups(repo, groups))}")
    for warning in plan.warnings:
        print(f"warning: {warning}", file=sys.stderr)
    for item in missing:
        print(f"warning: missing tool {item}", file=sys.stderr)
    return 0


def _resolve(
    repo: Path, project: Path, as_json: bool, mode: str, api_version: int = 2
) -> int:
    plan = resolve_project(repo, project, mode=mode)
    if as_json:
        output = json.dumps(
            plan.to_dict(api_version), ensure_ascii=False, separators=(",", ":")
        )
        sys.stdout.buffer.write((output + "\n").encode("utf-8"))
        sys.stdout.buffer.flush()
        return 0

    print(f"active: {'true' if plan.active else 'false'}")
    if api_version >= 2:
        print(f"mode: {plan.mode}")
    if plan.core is not None:
        print(f"core: {plan.core.name}@{plan.core.version}")
    print(f"groups: {len(plan.groups)}")
    print(f"rules: {len(plan.rules)}")
    print(f"skills: {len(plan.skills)}")
    print(f"agents: {len(plan.agents)}")
    print(f"commands: {len(plan.commands)}")
    print(f"mcp: {len(plan.mcp)}")
    for warning in plan.warnings:
        print(f"warning: {warning}", file=sys.stderr)
    return 0


def _models(args: argparse.Namespace) -> int:
    """Dispatch ``vibe-stack models`` commands without requiring a repository."""
    command = args.models_command
    if command == "catalog":
        return _emit_models(catalog_document(), bool(args.json))
    if command == "show":
        return _emit_models(models_summary(args.agent), bool(args.json))
    if command == "bind":
        state = bind_layer(
            args.layer,
            agent=args.agent,
            provider=args.provider,
            model=args.model,
            reasoning_effort=args.effort or None,
        )
        print(f"bound {args.layer} for {args.agent}")
        _print_binding_warnings(state.warnings)
        return 0
    if command == "unbind":
        state = unbind_layer(args.layer, agent=args.agent)
        print(f"unbound {args.layer} for {args.agent}")
        _print_binding_warnings(state.warnings)
        return 0
    if command == "default":
        layer = None if args.layer == "none" else args.layer
        state = set_default_layer(layer, agent=args.agent)
        print(f"default: {state.default or '(none)'}")
        _print_binding_warnings(state.warnings)
        return 0
    if command == "migrate":
        state = migrate_legacy(agent=args.agent)
        print(
            f"migrated {len(state.bindings)} layer(s) for {args.agent}"
            + (f"; default: {state.default}" if state.default else "")
        )
        _print_binding_warnings(state.warnings)
        return 0
    raise VibeStackError(f"unknown models command: {command}")


def _emit_models(document: dict[str, object], as_json: bool) -> int:
    """Render a catalog or binding summary."""
    if as_json:
        output = json.dumps(document, ensure_ascii=False, separators=(",", ":"))
        sys.stdout.buffer.write((output + "\n").encode("utf-8"))
        sys.stdout.buffer.flush()
        return 0
    print(f"default: {document.get('default', '')}")
    if "agent" in document:
        print(f"agent: {document['agent']}")
    layers = document.get("layers")
    for layer in layers if isinstance(layers, list) else []:
        if not isinstance(layer, dict):
            continue
        binding = layer.get("binding")
        if isinstance(binding, dict):
            route = f"{binding.get('provider')}/{binding.get('model')}"
            effort = binding.get("reasoningEffort")
            if effort:
                route = f"{route} · {effort}"
        else:
            route = "未绑定"
        print(f"  {str(layer.get('id', '')):<10} {layer.get('label', '')}  {route}")
    _print_binding_warnings(document.get("warnings", []))
    return 0


def _print_binding_warnings(warnings: object) -> None:
    if not isinstance(warnings, list):
        return
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)


def _tool(repo: Path, args: argparse.Namespace) -> int:
    if args.tool_command == "list":
        for tool in discover_tools(repo):
            print(f"{tool.id}  {tool.short_id}  [{tool.provider}]  {tool.description}")
        return 0
    extra = list(args.args)
    if extra and extra[0] == "--":
        extra = extra[1:]
    if args.tool_command == "exec":
        return exec_in_tool(repo, args.tool, extra)
    return run_tool(repo, args.tool, extra, serve=args.tool_command == "serve")


def _plugin(repo: Path, args: argparse.Namespace) -> int:
    if args.plugin_command == "list":
        for manifest in discover_plugins(repo):
            print(f"{manifest.get('agent')}@{manifest.get('version')}  {manifest.get('root')}")
        return 0
    if args.plugin_command == "status":
        data = plugin_status(repo, args.agent)
        print(f"agent: {data['agent']}")
        print(f"version: {data['version']}")
        print(f"source: {data['source']}")
        if data["target"]:
            print(f"target: {data['target']}")
            print(f"installed: {data['installed']}")
            print(f"skills: {data['skills_target']} ({data['skills_installed']})")
        else:
            print("install: external (dsh plugin add)")
        return 0
    raise VibeStackError(f"unknown plugin command: {args.plugin_command}")


if __name__ == "__main__":
    sys.exit(main())
