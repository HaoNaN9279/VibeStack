"""CLI smoke tests."""

from __future__ import annotations

from pathlib import Path

from vibe_stack.cli import main
from vibe_stack.repo import global_config_path


def test_cli_list_and_info(repo: Path, capsys) -> None:
    assert main(["--repo", str(repo), "list"]) == 0
    output = capsys.readouterr().out
    assert "data@1.0.0" in output
    assert main(["--repo", str(repo), "info", "data"]) == 0
    assert "extends: base" in capsys.readouterr().out


def test_cli_init_activate_status(
    repo: Path, project: Path, isolated_home: Path, capsys
) -> None:
    base = ["--repo", str(repo), "--project", str(project)]
    assert main([*base, "init", "--core", "core@0.1.0"]) == 0
    assert global_config_path().is_relative_to(isolated_home)
    assert main([*base, "activate", "data"]) == 0
    assert main([*base, "status"]) == 0
    output = capsys.readouterr().out
    assert "data@1.0.0" in output
    assert main([*base, "sync"]) == 0
    assert (project / ".vibestack" / "lock.json").is_file()
