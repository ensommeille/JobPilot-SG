"""JobPilot InternSG source adapter package."""

from .internsg_adapter import InternSGAdapter, default_internsg_config
from .models import AdapterBatch, JobRecord, RawJobItem, SourceConfig
from .source_adapter import SourceAdapter

__all__ = [
    "AdapterBatch",
    "InternSGAdapter",
    "JobRecord",
    "RawJobItem",
    "SourceAdapter",
    "SourceConfig",
    "default_internsg_config",
]
