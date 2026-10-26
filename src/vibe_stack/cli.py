"""Command line interface for VibeStack."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from vibe_stack import __version__
from vibe_stack.errors import VibeStackError
from vibe_stack.loader import discover_groups, discover_tools, load_group
from vibe_stack.plugin import discover_plugins, install as install_plugin, status as plugin_status
from vibe_stack.project import (
    activate,
    deactivate,
    init_stack,
    lock_path,
    missing_tools,
    parse_ref,
    read_stack,
    resolve_order,
    stack_path,
    tools_for_groups,
    write_lock,
)
from vibe_stack.repo import find_repo, write_global_config, read_global_config, default_core
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
    plugin_install = plugin_sub.add_parser("install", help="install an adapter")
    plugin_install.add_argument("agent")
    plugin_status_parser = plugin_sub.add_parser("status", help="adapter status")
    plugin_status_parser.add_argument("agent")

    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point."""
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        repo = find_repo(args.repo)
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
    groups = resolve_order(repo, stack)
    missing = missing_tools(repo, groups)
    path = write_lock(repo, project, stack)
    print(f"resolved {len(groups)} groups")
    print(f"lock: {path}")
    print(f"tools: {len(tools_for_groups(repo, groups))}")
    for item in missing:
        print(f"warning: missing tool {item}", file=sys.stderr)
    return 0


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
    if args.plugin_command == "install":
        for path in install_plugin(repo, args.agent):
            print(f"installed: {path}")
        config = read_global_config()
        config["repository"] = str(repo.resolve())
        write_global_config(config)
        return 0
    if args.plugin_command == "status":
        data = plugin_status(repo, args.agent)
        print(f"agent: {data['agent']}")
        print(f"version: {data['version']}")
        print(f"target: {data['target']}")
        print(f"installed: {data['installed']}")
        print(f"skills: {data['skills_target']} ({data['skills_installed']})")
        return 0
    raise VibeStackError(f"unknown plugin command: {args.plugin_command}")


if __name__ == "__main__":
    sys.exit(main())
