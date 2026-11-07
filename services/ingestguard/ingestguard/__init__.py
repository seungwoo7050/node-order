"""IngestGuard: Streaming chunk validation, idempotent record_key upsert, and quarantine replay."""

from ingestguard.app import create_app
from ingestguard.models import (
    Base,
    ColumnRule,
    IngestedRecordRow,
    IngestJobRow,
    IngestRequest,
    JobSummary,
    QuarantineItem,
    QuarantineRow,
    ReplayRequest,
    SchemaSpec,
)
from ingestguard.parser import (
    RejectedRow,
    ValidatedRow,
    build_row_validator,
    compute_payload_hash,
    iter_validated_chunks,
)
from ingestguard.replayer import (
    IngestGuardError,
    IngestService,
    MetricsCollector,
    QuarantineAlreadyReplayedError,
    QuarantineNotFoundError,
    ReplayValidationError,
)
from ingestguard.store import (
    ChunkApplyResult,
    IngestStore,
    create_db_engine,
)

__version__ = "0.1.0"

__all__ = [
    "Base",
    "ColumnRule",
    "IngestJobRow",
    "IngestedRecordRow",
    "QuarantineRow",
    "SchemaSpec",
    "IngestRequest",
    "JobSummary",
    "QuarantineItem",
    "ReplayRequest",
    "ValidatedRow",
    "RejectedRow",
    "compute_payload_hash",
    "build_row_validator",
    "iter_validated_chunks",
    "ChunkApplyResult",
    "IngestStore",
    "create_db_engine",
    "IngestGuardError",
    "ReplayValidationError",
    "QuarantineNotFoundError",
    "QuarantineAlreadyReplayedError",
    "MetricsCollector",
    "IngestService",
    "create_app",
    "__version__",
]
