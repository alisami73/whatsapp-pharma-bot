from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable, List, Optional

from .config import Settings
from .models import StructuredDocument, StructuredPage, detect_language


class AzureDocumentIntelligenceAnalyzer:
    """Extracts structured text from Azure Document Intelligence."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def analyze_document(
        self,
        source_url: str,
        document_id: str,
        source_file: str,
        source_path: str,
        preferred_model: Optional[str] = None,
    ) -> StructuredDocument:
        if not self.settings.azure_document_intelligence_endpoint or not self.settings.azure_document_intelligence_key:
            raise RuntimeError("Azure Document Intelligence n'est pas configuré.")

        model_candidates = [preferred_model or self.settings.azure_document_model]
        fallback_model = self.settings.azure_document_fallback_model
        if fallback_model and fallback_model not in model_candidates:
            model_candidates.append(fallback_model)

        errors: List[str] = []
        for model_id in model_candidates:
            try:
                return self._analyze_with_model(model_id, source_url, document_id, source_file, source_path)
            except Exception as exc:  # pragma: no cover - covered in real Azure environments
                errors.append(f"{model_id}: {exc}")
        raise RuntimeError("Échec Azure Document Intelligence: " + " | ".join(errors))

    def _analyze_with_model(
        self,
        model_id: str,
        source_url: str,
        document_id: str,
        source_file: str,
        source_path: str,
    ) -> StructuredDocument:
        try:
            from azure.core.credentials import AzureKeyCredential
            from azure.ai.documentintelligence import DocumentIntelligenceClient
            from azure.ai.documentintelligence.models import AnalyzeDocumentRequest
        except ImportError as exc:  # pragma: no cover - requires Azure deps
            raise RuntimeError("azure-ai-documentintelligence est requis pour Azure OCR.") from exc

        client = DocumentIntelligenceClient(
            endpoint=self.settings.azure_document_intelligence_endpoint,
            credential=AzureKeyCredential(self.settings.azure_document_intelligence_key),
        )
        poller = client.begin_analyze_document(model_id, AnalyzeDocumentRequest(url_source=source_url))
        result = poller.result()

        paragraph_map = self._collect_paragraphs_by_page(result.paragraphs or [])
        table_map = self._collect_tables_by_page(result.tables or [])

        pages: List[StructuredPage] = []
        aggregate = []
        for page in result.pages or []:
            page_number = getattr(page, "page_number", len(pages) + 1)
            lines = [line.content.strip() for line in getattr(page, "lines", []) if getattr(line, "content", "").strip()]
            paragraphs = paragraph_map.get(page_number, [])
            tables = table_map.get(page_number, [])
            text_parts = paragraphs or lines
            if tables:
                text_parts = list(text_parts) + tables
            text = "\n\n".join(part for part in text_parts if part)
            aggregate.append(text)
            words = getattr(page, "words", []) or []
            confidence = None
            if words:
                confidence = sum(getattr(word, "confidence", 0.0) for word in words) / len(words)

            heading_candidates = [paragraph for paragraph in paragraphs if self._looks_like_heading(paragraph)]
            pages.append(
                StructuredPage(
                    page_number=page_number,
                    text=text,
                    lines=lines,
                    paragraphs=paragraphs or lines,
                    tables=tables,
                    headings=heading_candidates,
                    extraction_method="azure_layout" if "layout" in model_id else "azure_read",
                    quality="high" if text.strip() else "low",
                    warnings=[] if text.strip() else ["empty_text"],
                    ocr_confidence=confidence,
                )
            )

        combined_text = "\n\n".join(aggregate)
        title = self._extract_title(result, pages, source_file)
        return StructuredDocument(
            document_id=document_id,
            source_file=source_file,
            source_path=source_path,
            title=title,
            language=detect_language(combined_text),
            page_count=len(pages),
            pages=pages,
            extraction_method="azure_layout" if "layout" in model_id else "azure_read",
            warnings=[],
            metadata={
                "azure_document_model": model_id,
                "paragraph_count": len(result.paragraphs or []),
                "table_count": len(result.tables or []),
            },
        )

    def _collect_paragraphs_by_page(self, paragraphs: Iterable[object]) -> Dict[int, List[str]]:
        mapping: Dict[int, List[str]] = defaultdict(list)
        for paragraph in paragraphs:
            content = getattr(paragraph, "content", "") or ""
            content = content.strip()
            if not content:
                continue
            regions = getattr(paragraph, "bounding_regions", []) or []
            if not regions:
                mapping[1].append(content)
                continue
            for region in regions:
                page_number = getattr(region, "page_number", None)
                if page_number is not None:
                    mapping[page_number].append(content)
        return mapping

    def _collect_tables_by_page(self, tables: Iterable[object]) -> Dict[int, List[str]]:
        mapping: Dict[int, List[str]] = defaultdict(list)
        for table in tables:
            cells = getattr(table, "cells", []) or []
            rows: Dict[int, Dict[int, str]] = defaultdict(dict)
            page_number = 1
            regions = getattr(table, "bounding_regions", []) or []
            if regions:
                page_number = getattr(regions[0], "page_number", 1)
            for cell in cells:
                rows[getattr(cell, "row_index", 0)][getattr(cell, "column_index", 0)] = (getattr(cell, "content", "") or "").strip()
            rendered_rows = []
            for row_index in sorted(rows):
                ordered = [value for _, value in sorted(rows[row_index].items()) if value]
                if ordered:
                    rendered_rows.append(" | ".join(ordered))
            if rendered_rows:
                mapping[page_number].append("\n".join(rendered_rows))
        return mapping

    def _extract_title(self, result: object, pages: List[StructuredPage], source_file: str) -> str:
        paragraphs = getattr(result, "paragraphs", []) or []
        for paragraph in paragraphs:
            role = (getattr(paragraph, "role", "") or "").lower()
            content = (getattr(paragraph, "content", "") or "").strip()
            if role == "title" and content:
                return content
        for page in pages:
            for heading in page.headings:
                if heading:
                    return heading
        return source_file

    def _looks_like_heading(self, text: str) -> bool:
        compact = " ".join(text.split())
        if not compact:
            return False
        if len(compact.split()) <= 10 and (compact.isupper() or compact.startswith(("Article", "ARTICLE", "Chapitre", "Section", "Titre", "الفصل", "المادة", "باب", "قسم"))):
            return True
        return False
