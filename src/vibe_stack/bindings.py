"""Machine-local model-layer bindings in the global VibeStack config.

The platform catalog owns layer ids and labels. This module only maps a layer
id to a concrete host route (provider/model/reasoningEffort) for one agent
adapter. Bindings live under ``models.bindings.<agent>`` so different hosts can
use different model namespaces without sharing a mapping.
"""

from __future__ import annotations

from dataclasses import dataclass

from vibe_stack.errors import VibeStackError
from vibe_stack.model_layers import (
    DEFAULT_MODEL_LAYER,
    MODEL_LAYER_IDS,
    is_model_layer,
    model_layer_catalog,
)
from vibe_stack.repo import read_global_config, write_global_config

#: Adapter used when the caller does not name one.
DEFAULT_AGENT = "dsh"

_MAX_ID = 32


@dataclass
class LayerBinding:
    """One host route bound to a platform layer."""

    provider: str
    model: str
    reasoning_effort: str | None = None

    def to_dict(self) -> dict[str, object]:
        data: dict[str, object] = {
            "provider": self.provider,
            "model": self.model,
        }
        if self.reasoning_effort:
            data["reasoningEffort"] = self.reasoning_effort
        return data


@dataclass
class ModelsState:
    """Normalized ``models`` section for one agent."""

    default: str | None
    bindings: dict[str, LayerBinding]
    warnings: list[str]

    def layers(self) -> list[dict[str, object]]:
        """Return the catalog annotated with this agent's bindings."""
        result: list[dict[str, object]] = []
        for layer in model_layer_catalog():
            binding = self.bindings.get(str(layer["id"]))
            result.append(
                {
                    **layer,
                    "binding": binding.to_dict() if binding is not None else None,
                    "bound": binding is not None,
                }
            )
        return result


def _models_section(data: dict[str, object]) -> dict[str, object]:
    models = data.get("models")
    return models if isinstance(models, dict) else {}


def _valid_layer_id(value: str) -> bool:
    return bool(value) and len(value) <= _MAX_ID and is_model_layer(value)


def _normalize_binding(
    raw: object, layer_id: str, warnings: list[str]
) -> LayerBinding | None:
    if not isinstance(raw, dict):
        warnings.append(f"binding {layer_id} is not an object")
        return None
    provider = frontmatter_text(raw.get("provider"))
    model = frontmatter_text(raw.get("model"))
    if not provider or not model:
        warnings.append(f"binding {layer_id} needs provider and model")
        return None
    effort = frontmatter_text(raw.get("reasoningEffort"))
    return LayerBinding(provider=provider, model=model, reasoning_effort=effort or None)


def frontmatter_text(value: object) -> str:
    """Return a trimmed string, accepting only scalar values."""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return ""


def _read_raw_bindings(
    models: dict[str, object], agent: str, warnings: list[str]
) -> tuple[dict[str, object], bool]:
    """Return raw binding entries and whether the legacy list was used."""
    bindings = models.get("bindings")
    if isinstance(bindings, dict):
        raw = bindings.get(agent)
        if raw is not None:
            if isinstance(raw, dict):
                return raw, False
            warnings.append(f"models.bindings.{agent} must be an object")
            return {}, False
        legacy = models.get("layers")
        if isinstance(legacy, list):
            warnings.append(
                "models.layers is a legacy DSH format; run `vibe-stack models migrate`"
            )
            return {"__legacy__": legacy}, True
        return {}, False
    legacy = models.get("layers")
    if isinstance(legacy, list):
        warnings.append(
            "models.layers is a legacy DSH format; run `vibe-stack models migrate`"
        )
        return {"__legacy__": legacy}, True
    if bindings is not None:
        warnings.append("models.bindings must be an object")
    return {}, False


def _normalize_entries(
    raw: object, warnings: list[str], *, legacy: bool = False
) -> dict[str, LayerBinding]:
    result: dict[str, LayerBinding] = {}
    entries: list[tuple[str, object]]
    if legacy and isinstance(raw, dict):
        entries = []
        for item in raw.get("__legacy__", []):
            if not isinstance(item, dict):
                warnings.append("legacy model layer entry is not an object")
                continue
            layer_id = frontmatter_text(item.get("id"))
            if layer_id == "flash":
                layer_id = "fast"
            entries.append((layer_id, item))
    elif isinstance(raw, dict):
        entries = [(str(key), value) for key, value in raw.items()]
    elif isinstance(raw, list):
        entries = []
        for item in raw:
            if not isinstance(item, dict):
                warnings.append("model binding entry is not an object")
                continue
            entries.append((frontmatter_text(item.get("id")), item))
    else:
        return result

    for layer_id, item in entries:
        if not _valid_layer_id(layer_id):
            warnings.append(f"unknown model layer binding: {layer_id or '(empty)'}")
            continue
        binding = _normalize_binding(item, layer_id, warnings)
        if binding is None:
            continue
        if layer_id in result:
            warnings.append(f"duplicate model layer binding: {layer_id}")
        result[layer_id] = binding
    return result


def read_models_state(
    agent: str = DEFAULT_AGENT, data: dict[str, object] | None = None
) -> ModelsState:
    """Read and normalize one agent's bindings."""
    document = read_global_config() if data is None else data
    models = _models_section(document)
    warnings: list[str] = []
    raw, legacy = _read_raw_bindings(models, agent, warnings)
    bindings = _normalize_entries(raw, warnings, legacy=legacy)
    default = frontmatter_text(models.get("default")) or None
    if default == "flash":
        default = "fast"
    return ModelsState(default=default, bindings=bindings, warnings=warnings)


def _write_state(
    agent: str,
    bindings: dict[str, LayerBinding],
    default: str | None,
    *,
    keep_default: bool = True,
) -> ModelsState:
    document = read_global_config()
    models = _models_section(document)
    bindings_all = models.get("bindings")
    if not isinstance(bindings_all, dict):
        bindings_all = {}
    bindings_all[agent] = {
        layer_id: binding.to_dict()
        for layer_id, binding in sorted(bindings.items())
    }
    models["bindings"] = bindings_all
    if keep_default:
        if default is None:
            models.pop("default", None)
        else:
            models["default"] = default
    document["models"] = models
    write_global_config(document)
    return ModelsState(default=default, bindings=dict(bindings), warnings=[])


def bind_layer(
    layer_id: str,
    *,
    agent: str = DEFAULT_AGENT,
    provider: str,
    model: str,
    reasoning_effort: str | None = None,
) -> ModelsState:
    """Bind one platform layer to a host route."""
    if not _valid_layer_id(layer_id):
        raise VibeStackError(f"unknown model layer: {layer_id}")
    if not provider.strip() or not model.strip():
        raise VibeStackError("provider and model must be non-empty")
    state = read_models_state(agent)
    state.bindings[layer_id] = LayerBinding(
        provider=provider.strip(),
        model=model.strip(),
        reasoning_effort=(reasoning_effort or "").strip() or None,
    )
    return _write_state(agent, state.bindings, state.default, keep_default=False)


def unbind_layer(layer_id: str, *, agent: str = DEFAULT_AGENT) -> ModelsState:
    """Remove one layer binding."""
    if not _valid_layer_id(layer_id):
        raise VibeStackError(f"unknown model layer: {layer_id}")
    state = read_models_state(agent)
    state.bindings.pop(layer_id, None)
    return _write_state(agent, state.bindings, state.default, keep_default=False)


def set_default_layer(
    layer_id: str | None, *, agent: str = DEFAULT_AGENT
) -> ModelsState:
    """Set or clear the global default layer."""
    if layer_id is not None and not _valid_layer_id(layer_id):
        raise VibeStackError(f"unknown model layer: {layer_id}")
    state = read_models_state(agent)
    return _write_state(agent, state.bindings, layer_id)


def migrate_legacy(*, agent: str = DEFAULT_AGENT) -> ModelsState:
    """Convert ``models.layers`` into ``models.bindings.<agent>``.

    ``flash`` is mapped to ``fast``; entries whose id is not a platform layer
    are reported and dropped. The legacy key is removed after a successful
    write.
    """
    document = read_global_config()
    models = _models_section(document)
    legacy = models.get("layers")
    warnings: list[str] = []
    if not isinstance(legacy, list):
        return ModelsState(default=None, bindings={}, warnings=["no models.layers to migrate"])
    bindings = _normalize_entries({"__legacy__": legacy}, warnings, legacy=True)
    default = frontmatter_text(models.get("default")) or None
    if default == "flash":
        default = "fast"
    if default is not None and not _valid_layer_id(default):
        warnings.append(f"dropped unknown default model layer: {default}")
        default = None
    models.pop("layers", None)
    models["bindings"] = {
        **(models.get("bindings") if isinstance(models.get("bindings"), dict) else {}),
        agent: {
            layer_id: binding.to_dict()
            for layer_id, binding in sorted(bindings.items())
        },
    }
    if default is None:
        models.pop("default", None)
    else:
        models["default"] = default
    document["models"] = models
    write_global_config(document)
    return ModelsState(default=default, bindings=bindings, warnings=warnings)


def models_summary(agent: str = DEFAULT_AGENT) -> dict[str, object]:
    """Return a JSON-ready catalog plus bindings for one agent."""
    state = read_models_state(agent)
    return {
        "schema_version": 1,
        "agent": agent,
        "default": state.default or DEFAULT_MODEL_LAYER,
        "layers": state.layers(),
        "warnings": state.warnings,
    }


def catalog_document() -> dict[str, object]:
    """Return the platform catalog only."""
    return {
        "schema_version": 1,
        "default": DEFAULT_MODEL_LAYER,
        "layers": model_layer_catalog(),
    }


__all__ = [
    "DEFAULT_AGENT",
    "DEFAULT_MODEL_LAYER",
    "LayerBinding",
    "MODEL_LAYER_IDS",
    "ModelsState",
    "bind_layer",
    "catalog_document",
    "is_model_layer",
    "migrate_legacy",
    "models_summary",
    "read_models_state",
    "set_default_layer",
    "unbind_layer",
]
