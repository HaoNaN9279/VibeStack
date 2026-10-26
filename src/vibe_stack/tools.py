"""Run tool packages through the ``vibe-stack`` entry point."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from vibe_stack.errors import ToolNotFoundError, VibeStackError
from vibe_stack.loader import find_tool
from vibe_stack.model import ToolMeta


def run_tool(repo: Path, identifier: str, args: list[str], serve: bool = False) -> int:
    """Run or serve one tool package.

    Args:
        repo: VibeStack repository root.
        identifier: Tool id, ``name@version``, name, or guid.
        args: Arguments forwarded to the tool command.
        serve: Start the tool's MCP server instead of its CLI.

    Returns:
        The tool process exit code.
    """
    tool = find_tool(repo, identifier)
    if serve:
        return _serve(tool, args)
    return _run(tool, args)


def exec_in_tool(repo: Path, identifier: str, args: list[str]) -> int:
    """Run an arbitrary command inside a Python tool's uv environment."""
    tool = find_tool(repo, identifier)
    if not (tool.root / "pyproject.toml").is_file():
        raise VibeStackError(f"tool '{tool.short_id}' has no pyproject.toml")
    if not args:
        raise VibeStackError("tool exec needs a command, e.g. `python -m module`")
    _ensure_synced(tool.root)
    uv = shutil.which("uv")
    if uv is None:
        raise VibeStackError("uv is required to run tool packages")
    return _execute(
        tool,
        [uv, "run", "--project", str(tool.root), *args],
        [],
    )


def _run(tool: ToolMeta, args: list[str]) -> int:
    if tool.provider == "mcp":
        raise VibeStackError(
            f"tool '{tool.short_id}' is an MCP server; use `vibe-stack tool serve {tool.id}`"
        )
    command = _python_command(tool, serve=False)
    return _execute(tool, command, args)


def _serve(tool: ToolMeta, args: list[str]) -> int:
    if tool.provider == "mcp":
        if tool.mcp is None:
            raise ToolNotFoundError(f"tool '{tool.short_id}' has no MCP config")
        command = [str(item) for item in tool.mcp.get("command", [])]
        if not command:
            raise VibeStackError(f"tool '{tool.short_id}' MCP command is empty")
        return _execute(tool, command, args)
    command = _python_command(tool, serve=True)
    return _execute(tool, command, args)


def _python_command(tool: ToolMeta, serve: bool) -> list[str]:
    if tool.run is None or tool.run.get("kind") != "uv":
        raise VibeStackError(
            f"tool '{tool.short_id}' has no uv run configuration"
        )
    if not (tool.root / "pyproject.toml").is_file():
        raise VibeStackError(f"tool '{tool.short_id}' has no pyproject.toml")
    _ensure_synced(tool.root)
    key = "serve_command" if serve else "command"
    command = tool.run.get(key) or tool.run.get("command")
    if not command:
        raise VibeStackError(f"tool '{tool.short_id}' has no command")
    uv = shutil.which("uv")
    if uv is None:
        raise VibeStackError("uv is required to run tool packages")
    return [uv, "run", "--project", str(tool.root), str(command)]


def _ensure_synced(tool_root: Path) -> None:
    if (tool_root / ".venv").is_dir():
        return
    uv = shutil.which("uv")
    if uv is None:
        raise VibeStackError("uv is required to install tool dependencies")
    print(f"[vibe-stack] syncing {tool_root}", file=sys.stderr)
    result = subprocess.run(
        [uv, "sync", "--project", str(tool_root)], check=False
    )
    if result.returncode != 0:
        raise VibeStackError(f"uv sync failed for {tool_root}")


def _execute(tool: ToolMeta, command: list[str], args: list[str]) -> int:
    try:
        return subprocess.call([*command, *args])
    except FileNotFoundError as exc:
        raise VibeStackError(
            f"cannot start tool '{tool.short_id}': {exc.filename} not found"
        ) from exc
