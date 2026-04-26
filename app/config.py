from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional dependency for local env loading
    load_dotenv = None


ROOT = Path(__file__).resolve().parent.parent


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return int(raw)


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return float(raw)


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


@dataclass(slots=True)
class Settings:
    azure_document_intelligence_endpoint: str = ""
    azure_document_intelligence_key: str = ""
    azure_document_model: str = "prebuilt-layout"
    azure_document_fallback_model: str = "prebuilt-read"
    azure_blob_connection_string: str = ""
    azure_blob_container: str = "rag-documents"
    azure_blob_prefix: str = "ocr-ingestion"
    ocr_low_threshold: float = 0.55
    chunk_size: int = 320
    chunk_overlap: int = 40
    top_k: int = 4
    embedding_provider: str = "mock"
    vector_store_provider: str = "json"
    vector_store_path: Path = ROOT / "data" / "legal_kb" / "indexes" / "azure_ocr_pipeline_index.json"
    low_ocr_journal_path: Path = ROOT / "data" / "legal_kb" / "audit" / "low_ocr_journal.jsonl"
    azure_search_endpoint: str = ""
    azure_search_api_key: str = ""
    azure_search_index_name: str = ""
    azure_search_api_version: str = "2025-09-01"
    azure_search_batch_size: int = 100
    azure_search_enable_hybrid: bool = True
    azure_search_enable_semantic_reranker: bool = False
    azure_search_semantic_configuration: str = ""
    azure_openai_api_key: str = ""
    azure_openai_endpoint: str = ""
    azure_openai_api_version: str = "2024-10-21"
    azure_openai_embedding_deployment: str = ""
    openai_api_key: str = ""
    openai_embedding_model: str = ""
    swift_extractor_path: Path = ROOT / "scripts" / "extract_pdf_pages.swift"
    swift_module_cache_path: Path = Path("/tmp/swift-module-cache")
    max_retries: int = 2
    log_level: str = "INFO"

    @classmethod
    def from_env(cls) -> "Settings":
        if load_dotenv is not None:
            load_dotenv()
        return cls(
            azure_document_intelligence_endpoint=os.getenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", ""),
            azure_document_intelligence_key=os.getenv("AZURE_DOCUMENT_INTELLIGENCE_KEY", ""),
            azure_document_model=os.getenv("AZURE_DOCUMENT_MODEL", "prebuilt-layout"),
            azure_document_fallback_model=os.getenv("AZURE_DOCUMENT_FALLBACK_MODEL", "prebuilt-read"),
            azure_blob_connection_string=os.getenv("AZURE_BLOB_CONNECTION_STRING", ""),
            azure_blob_container=os.getenv("AZURE_BLOB_CONTAINER", "rag-documents"),
            azure_blob_prefix=os.getenv("AZURE_BLOB_PREFIX", "ocr-ingestion"),
            ocr_low_threshold=_env_float("OCR_LOW_THRESHOLD", 0.55),
            chunk_size=_env_int("CHUNK_SIZE", 320),
            chunk_overlap=_env_int("CHUNK_OVERLAP", 40),
            top_k=_env_int("TOP_K", 4),
            embedding_provider=os.getenv("EMBEDDING_PROVIDER", "mock").strip().lower(),
            vector_store_provider=os.getenv("VECTOR_STORE_PROVIDER", "json").strip().lower(),
            vector_store_path=Path(os.getenv("VECTOR_STORE_PATH", str(ROOT / "data" / "legal_kb" / "indexes" / "azure_ocr_pipeline_index.json"))),
            low_ocr_journal_path=Path(os.getenv("LOW_OCR_JOURNAL_PATH", str(ROOT / "data" / "legal_kb" / "audit" / "low_ocr_journal.jsonl"))),
            azure_search_endpoint=os.getenv("AZURE_SEARCH_ENDPOINT", ""),
            azure_search_api_key=os.getenv("AZURE_SEARCH_API_KEY", ""),
            azure_search_index_name=os.getenv("AZURE_SEARCH_INDEX_NAME", ""),
            azure_search_api_version=os.getenv("AZURE_SEARCH_API_VERSION", "2025-09-01"),
            azure_search_batch_size=_env_int("AZURE_SEARCH_BATCH_SIZE", 100),
            azure_search_enable_hybrid=_env_bool("AZURE_SEARCH_ENABLE_HYBRID", True),
            azure_search_enable_semantic_reranker=_env_bool("AZURE_SEARCH_ENABLE_SEMANTIC_RERANKER", False),
            azure_search_semantic_configuration=os.getenv("AZURE_SEARCH_SEMANTIC_CONFIGURATION", ""),
            azure_openai_api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
            azure_openai_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
            azure_openai_api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21"),
            azure_openai_embedding_deployment=os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", ""),
            openai_api_key=os.getenv("OPENAI_API_KEY", ""),
            openai_embedding_model=os.getenv("OPENAI_EMBEDDING_MODEL", ""),
            swift_extractor_path=Path(os.getenv("SWIFT_EXTRACTOR_PATH", str(ROOT / "scripts" / "extract_pdf_pages.swift"))),
            swift_module_cache_path=Path(os.getenv("SWIFT_MODULE_CACHE_PATH", "/tmp/swift-module-cache")),
            max_retries=_env_int("PIPELINE_MAX_RETRIES", 2),
            log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        )
