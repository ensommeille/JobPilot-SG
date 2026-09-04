"""Evidence-aware job extraction; model clients are supplied by the shared LLM layer."""

from .inputs import input_from_job, input_from_raw_item
from .models import ExtractionInput, ExtractionResult, JobExtractionSchema
from .service import ExtractionConfig, JobExtractionService

__all__ = [
    "ExtractionConfig",
    "ExtractionInput",
    "ExtractionResult",
    "JobExtractionSchema",
    "JobExtractionService",
    "input_from_job",
    "input_from_raw_item",
]
