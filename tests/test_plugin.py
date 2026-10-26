"""Plugin adapter installation tests."""

from __future__ import annotations

from pathlib import Path

from vibe_stack.plugin import install, status


def test_install_copies_plugin_and_skill(
    repo: Path, tmp_path: Path, monkeypatch
) -> None:
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    written = install(repo, "opencode")
    target = home / ".config/opencode/plugins/vibestack.ts"
    skill = home / ".config/opencode/plugins/vibestack-skills/vibestack/SKILL.md"
    assert target.is_file()
    assert skill.is_file()
    assert target in written
    data = status(repo, "opencode")
    assert data["installed"] is True
    assert data["skills_installed"] is True
    assert (home / ".config/vibestack/config.json").is_file()
