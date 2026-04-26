from __future__ import annotations

import json
import sys
from typing import Optional

from .config import Settings
from .models import IngestionResult
from .pipeline import DocumentIngestionPipeline


def ingest_document(file_path: str, settings: Optional[Settings] = None) -> IngestionResult:
    """Main entrypoint used by the chatbot or batch jobs."""

    pipeline = DocumentIngestionPipeline(settings=settings)
    return pipeline.ingest_document(file_path)


def main(argv: list[str] | None = None) -> int:
    args = list(argv or sys.argv[1:])
    if not args:
        print("Usage: python -m app.ingestion_service <file_path>", file=sys.stderr)
        return 1
    result = ingest_document(args[0])
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    return 0 if result.status == "success" else 2


if __name__ == "__main__":
    raise SystemExit(main())
