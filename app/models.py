from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
import re
from typing import Any, Dict, List, Optional
import unicodedata


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    asciiish = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    slug = re.sub(r"[^0-9A-Za-z\u0600-\u06FF]+", "_", asciiish.lower()).strip("_")
    return re.sub(r"_+", "_", slug) or "document"


def detect_language(text: str) -> str:
    arabic = sum(1 for ch in text if "\u0600" <= ch <= "\u06FF")
    latin = sum(1 for ch in text if ch.isalpha() and ord(ch) < 0x0600)
    if arabic > 20 and latin > 20:
        return "mixed"
    if arabic > 20:
        return "ar"
    if latin > 20:
        return "fr"
    return "unknown"


def to_serializable(value: Any) -> Any:
    if is_dataclass(value):
        return {key: to_serializable(item) for key, item in asdict(value).items()}
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): to_serializable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_serializable(item) for item in value]
    return value


@dataclass(slots=True)
class StructuredPage:
    page_number: int
    text: str
    lines: List[str] = field(default_factory=list)
    paragraphs: List[str] = field(default_factory=list)
    tables: List[str] = field(default_factory=list)
    headings: List[str] = field(default_factory=list)
    extraction_method: str = "native"
    quality: str = "unknown"
    warnings: List[str] = field(default_factory=list)
    ocr_confidence: Optional[float] = None


@dataclass(slots=True)
class StructuredDocument:
    document_id: str
    source_file: str
    source_path: str
    title: Optional[str]
    language: str
    page_count: int
    pages: List[StructuredPage]
    extraction_method: str
    created_at: str = field(default_factory=utc_now_iso)
    warnings: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def full_text(self) -> str:
        return "\n\n".join(page.text for page in self.pages if page.text.strip())


@dataclass(slots=True)
class OCRQualityResult:
    is_low_ocr: bool
    score: float
    reasons: List[str]
    metrics: Dict[str, float] = field(default_factory=dict)


@dataclass(slots=True)
class BlobUploadResult:
    blob_name: str
    blob_url: str
    sas_url: str
    container: str
    version_id: Optional[str] = None
    etag: Optional[str] = None


@dataclass(slots=True)
class Chunk:
    chunk_id: str
    doc_id: str
    source_file: str
    source_path: str
    page_start: int
    page_end: int
    section_title: str
    content: str
    language: str
    extraction_method: str
    ocr_score: float
    created_at: str
    keywords: List[str] = field(default_factory=list)
    user_questions: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class PipelineStepResult:
    step: str
    status: str
    duration_ms: int
    warnings: List[str] = field(default_factory=list)
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class IngestionResult:
    document_id: str
    method_used: str
    low_ocr_detected: bool
    number_of_chunks: int
    pages_processed: int
    warnings: List[str]
    status: str
    ocr_score: float = 0.0
    low_ocr_reasons: List[str] = field(default_factory=list)
    steps: List[PipelineStepResult] = field(default_factory=list)
    chunks: List[Chunk] = field(default_factory=list)
    vector_store_ids: List[str] = field(default_factory=list)
    blob_name: Optional[str] = None
    blob_url: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return to_serializable(self)
