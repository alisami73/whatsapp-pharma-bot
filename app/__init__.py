"""RAG ingestion package with native extraction and Azure OCR fallback."""

from .config import Settings
from .models import IngestionResult


def ingest_document(*args, **kwargs):
    from .ingestion_service import ingest_document as _ingest_document

    return _ingest_document(*args, **kwargs)


__all__ = ["Settings", "IngestionResult", "ingest_document"]
