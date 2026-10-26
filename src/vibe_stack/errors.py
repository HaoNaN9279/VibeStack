"""Exceptions for VibeStack."""

from __future__ import annotations


class VibeStackError(Exception):
    """Base error for every VibeStack failure."""


class GroupNotFoundError(VibeStackError):
    """A capability group or version does not exist."""


class GroupAlreadyActiveError(VibeStackError):
    """A capability group is already active in the project."""


class GroupNotActiveError(VibeStackError):
    """A capability group is not active in the project."""


class ToolNotFoundError(VibeStackError):
    """A tool package does not exist."""


class ProjectConfigError(VibeStackError):
    """``.vibestack/stack.json`` is missing or malformed."""


class PluginNotFoundError(VibeStackError):
    """No plugin adapter exists for the requested agent tool."""
