"""Load a recorded expert by version and source hash for historical replay."""
import hashlib
import importlib.util
from pathlib import Path
import sys

import rocket_expert

_ARCHIVES = {
    'expert-prototype-v0.4': Path(__file__).resolve().parent / 'versions' / 'expert-prototype-v0.4' / 'rocket_expert.py',
    'continuous-reference-prototype-v0.2': Path(__file__).resolve().parent / 'versions' / 'expert-prototype-v0.4' / 'rocket_expert.py',
    'expert-prototype-v0.5': Path(__file__).resolve().parent / 'versions' / 'expert-prototype-v0.5' / 'rocket_expert.py',
    'continuous-reference-prototype-v0.3': Path(__file__).resolve().parent / 'versions' / 'expert-prototype-v0.5' / 'rocket_expert.py',
}


def load_expert(version, source_sha256):
    """Return only an exact current or locally archived expert implementation."""
    if version == rocket_expert.EXPERT_VERSION and source_sha256 == rocket_expert.SOURCE_SHA256:
        return rocket_expert
    path = _ARCHIVES.get(version)
    if path is None or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != source_sha256:
        raise ValueError('recorded expert version and source are unavailable')
    name = 'rocket_expert_archive_' + source_sha256
    module = sys.modules.get(name)
    if module is None:
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        try:
            spec.loader.exec_module(module)
        except Exception:
            del sys.modules[name]
            raise
    if version not in (module.EXPERT_VERSION, module.ContinuousReference.version) or module.SOURCE_SHA256 != source_sha256:
        raise ValueError('archived expert provenance does not match')
    return module
