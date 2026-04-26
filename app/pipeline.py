from __future__ import annotations

import json
import logging
from pathlib import Path
import time
from typing import Callable, List, Optional, Tuple, TypeVar
from collections.abc import Sequence

from .azure_blob import AzureBlobUploader
from .azure_doc_intelligence import AzureDocumentIntelligenceAnalyzer
from .chunker import SemanticChunker
from .config import Settings
from .embeddings import build_embedding_text, create_embedding_provider
from .logging_utils import get_logger, log_event
from .models import IngestionResult, PipelineStepResult, StructuredDocument, to_serializable
from .native_extractor import NativePdfExtractor
from .ocr_detection import LowOCRDetector
from .text_cleaner import TextCleaner
from .vector_store import create_vector_store


T = TypeVar("T")


class DocumentIngestionPipeline:
    """End-to-end ingestion pipeline with native extraction and Azure OCR fallback."""

    def __init__(
        self,
        settings: Optional[Settings] = None,
        native_extractor: Optional[NativePdfExtractor] = None,
        ocr_detector: Optional[LowOCRDetector] = None,
        blob_uploader: Optional[AzureBlobUploader] = None,
        azure_analyzer: Optional[AzureDocumentIntelligenceAnalyzer] = None,
        cleaner: Optional[TextCleaner] = None,
        chunker: Optional[SemanticChunker] = None,
    ) -> None:
        self.settings = settings or Settings.from_env()
        self.logger = get_logger("rag_ingestion", self.settings.log_level)
        self.native_extractor = native_extractor or NativePdfExtractor(
            self.settings.swift_extractor_path,
            self.settings.swift_module_cache_path,
        )
        self.ocr_detector = ocr_detector or LowOCRDetector(self.settings.ocr_low_threshold)
        self.blob_uploader = blob_uploader or AzureBlobUploader(self.settings)
        self.azure_analyzer = azure_analyzer or AzureDocumentIntelligenceAnalyzer(self.settings)
        self.cleaner = cleaner or TextCleaner()
        self.chunker = chunker or SemanticChunker(self.settings.chunk_size, self.settings.chunk_overlap)
        self.embedding_provider = create_embedding_provider(self.settings)
        self.vector_store = create_vector_store(self.settings)

    def ingest_document(self, file_path: str) -> IngestionResult:
        steps: List[PipelineStepResult] = []
        warnings: List[str] = []
        blob_name: Optional[str] = None
        blob_url: Optional[str] = None
        method_used = "native"
        low_ocr_detected = False
        low_ocr_score = 0.0
        low_ocr_reasons: List[str] = []
        document: Optional[StructuredDocument] = None

        try:
            document, step = self._run_step("native_extraction", lambda: self.native_extractor.extract(file_path))
            steps.append(step)

            assessment, step = self._run_step("ocr_detection", lambda: self.ocr_detector.assess(document))
            steps.append(step)
            low_ocr_detected = assessment.is_low_ocr
            low_ocr_score = assessment.score
            low_ocr_reasons = list(assessment.reasons)

            if assessment.is_low_ocr:
                self._append_low_ocr_journal(document.document_id, file_path, assessment)
                warnings.extend([f"low_ocr:{reason}" for reason in assessment.reasons])

                upload_result, step = self._run_step(
                    "azure_blob_upload",
                    lambda: self._retry(lambda: self.blob_uploader.upload_file(file_path, document.document_id)),
                )
                steps.append(step)
                blob_name = upload_result.blob_name
                blob_url = upload_result.blob_url

                azure_document, step = self._run_step(
                    "azure_document_intelligence",
                    lambda: self._retry(
                        lambda: self.azure_analyzer.analyze_document(
                            source_url=upload_result.sas_url,
                            document_id=document.document_id,
                            source_file=document.source_file,
                            source_path=document.source_path,
                        )
                    ),
                )
                steps.append(step)
                document = azure_document
                method_used = document.extraction_method
            else:
                method_used = "native"

            document, step = self._run_step("text_cleaning", lambda: self.cleaner.clean_document(document))
            steps.append(step)

            chunks, step = self._run_step(
                "semantic_chunking",
                lambda: self.chunker.chunk_document(document, ocr_score=low_ocr_score),
            )
            steps.append(step)

            embeddings, step = self._run_step(
                "embeddings",
                lambda: self._retry(lambda: self.embedding_provider.embed_documents([build_embedding_text(chunk) for chunk in chunks])),
            )
            steps.append(step)

            vector_store_ids, step = self._run_step(
                "vector_indexation",
                lambda: self.vector_store.index_chunks(chunks, embeddings),
            )
            steps.append(step)

            log_event(
                self.logger,
                logging.INFO,
                "document_ingestion_succeeded",
                document_id=document.document_id,
                method_used=method_used,
                low_ocr_detected=low_ocr_detected,
                number_of_chunks=len(chunks),
            )
            return IngestionResult(
                document_id=document.document_id,
                method_used=method_used,
                low_ocr_detected=low_ocr_detected,
                number_of_chunks=len(chunks),
                pages_processed=document.page_count,
                warnings=warnings,
                status="success",
                ocr_score=low_ocr_score,
                low_ocr_reasons=low_ocr_reasons,
                steps=steps,
                chunks=chunks,
                vector_store_ids=vector_store_ids,
                blob_name=blob_name,
                blob_url=blob_url,
            )
        except Exception as exc:
            failed_id = document.document_id if document is not None else Path(file_path).stem
            log_event(
                self.logger,
                logging.ERROR,
                "document_ingestion_failed",
                document_id=failed_id,
                error=str(exc),
            )
            warnings.append(str(exc))
            return IngestionResult(
                document_id=failed_id,
                method_used=method_used,
                low_ocr_detected=low_ocr_detected,
                number_of_chunks=0,
                pages_processed=document.page_count if document is not None else 0,
                warnings=warnings,
                status="failed",
                ocr_score=low_ocr_score,
                low_ocr_reasons=low_ocr_reasons,
                steps=steps,
                chunks=[],
                vector_store_ids=[],
                blob_name=blob_name,
                blob_url=blob_url,
            )

    def _retry(self, operation: Callable[[], T]) -> T:
        attempt = 0
        while True:
            try:
                return operation()
            except Exception:
                if attempt >= self.settings.max_retries:
                    raise
                sleep_seconds = min(2 ** attempt, 5)
                time.sleep(sleep_seconds)
                attempt += 1

    def _run_step(self, name: str, operation: Callable[[], T]) -> Tuple[T, PipelineStepResult]:
        start = time.perf_counter()
        try:
            result = operation()
            duration_ms = int((time.perf_counter() - start) * 1000)
            step = PipelineStepResult(step=name, status="success", duration_ms=duration_ms)
            details = self._step_details(result)
            step.details.update(details)
            log_event(self.logger, logging.INFO, "pipeline_step_succeeded", step=name, duration_ms=duration_ms, **details)
            return result, step
        except Exception as exc:
            duration_ms = int((time.perf_counter() - start) * 1000)
            step = PipelineStepResult(step=name, status="failed", duration_ms=duration_ms, warnings=[str(exc)])
            log_event(self.logger, logging.ERROR, "pipeline_step_failed", step=name, duration_ms=duration_ms, error=str(exc))
            raise

    def _step_details(self, result: object) -> dict:
        if isinstance(result, StructuredDocument):
            return {
                "page_count": result.page_count,
                "method": result.extraction_method,
                "document_id": result.document_id,
            }
        if hasattr(result, "score") and hasattr(result, "is_low_ocr"):
            return {
                "low_ocr_detected": getattr(result, "is_low_ocr"),
                "ocr_score": getattr(result, "score"),
            }
        if isinstance(result, Sequence) and not isinstance(result, (str, bytes)) and result and hasattr(result[0], "chunk_id"):
            return {"chunk_count": len(result)}
        if (
            isinstance(result, Sequence)
            and not isinstance(result, (str, bytes))
            and result
            and isinstance(result[0], Sequence)
            and not isinstance(result[0], (str, bytes))
        ):
            return {"embedding_count": len(result), "dimensions": len(result[0])}
        if isinstance(result, Sequence) and not isinstance(result, (str, bytes)):
            return {"count": len(result)}
        if hasattr(result, "blob_name"):
            return {"blob_name": getattr(result, "blob_name")}
        return {}

    def _append_low_ocr_journal(self, document_id: str, file_path: str, assessment: object) -> None:
        self.settings.low_ocr_journal_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "document_id": document_id,
            "file_path": file_path,
            "is_low_ocr": getattr(assessment, "is_low_ocr", False),
            "score": getattr(assessment, "score", 0.0),
            "reasons": getattr(assessment, "reasons", []),
            "metrics": getattr(assessment, "metrics", {}),
        }
        with self.settings.low_ocr_journal_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(to_serializable(payload), ensure_ascii=False) + "\n")
