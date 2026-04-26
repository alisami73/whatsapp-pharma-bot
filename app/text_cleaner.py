from __future__ import annotations

import re
import unicodedata

from .models import StructuredDocument, StructuredPage, detect_language


LATIN_HYPHEN_BREAK_RE = re.compile(r"([A-Za-zÀ-ÿ])-\n([A-Za-zÀ-ÿ])")
MULTISPACE_RE = re.compile(r"[ \t]{2,}")
EXCESS_NEWLINES_RE = re.compile(r"\n{3,}")


class TextCleaner:
    """Normalizes extracted text while preserving document structure."""

    def clean_document(self, document: StructuredDocument) -> StructuredDocument:
        cleaned_pages = [self.clean_page(page) for page in document.pages]
        full_text = "\n\n".join(page.text for page in cleaned_pages if page.text.strip())
        return StructuredDocument(
            document_id=document.document_id,
            source_file=document.source_file,
            source_path=document.source_path,
            title=self.clean_text(document.title or "", preserve_newlines=False) or document.title,
            language=detect_language(full_text) if full_text else document.language,
            page_count=document.page_count,
            pages=cleaned_pages,
            extraction_method=document.extraction_method,
            created_at=document.created_at,
            warnings=list(document.warnings),
            metadata=dict(document.metadata),
        )

    def clean_page(self, page: StructuredPage) -> StructuredPage:
        paragraphs = [self.clean_text(item) for item in page.paragraphs or [page.text]]
        paragraphs = [item for item in paragraphs if item.strip()]
        lines = [self.clean_text(line, preserve_newlines=False) for line in page.lines or page.text.splitlines()]
        lines = [line for line in lines if line]
        tables = [self.clean_text(table) for table in page.tables]
        headings = [self.clean_text(heading, preserve_newlines=False) for heading in page.headings]
        text = "\n\n".join(paragraphs) if paragraphs else self.clean_text(page.text)
        return StructuredPage(
            page_number=page.page_number,
            text=text,
            lines=lines,
            paragraphs=paragraphs or ([text] if text else []),
            tables=[table for table in tables if table],
            headings=[heading for heading in headings if heading],
            extraction_method=page.extraction_method,
            quality=page.quality,
            warnings=list(page.warnings),
            ocr_confidence=page.ocr_confidence,
        )

    def clean_text(self, text: str, preserve_newlines: bool = True) -> str:
        if not text:
            return ""
        cleaned = unicodedata.normalize("NFC", text.replace("\x00", "").replace("\ufeff", ""))
        cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n").replace("\u00A0", " ")
        cleaned = LATIN_HYPHEN_BREAK_RE.sub(r"\1\2", cleaned)
        cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
        cleaned = MULTISPACE_RE.sub(" ", cleaned)
        if preserve_newlines:
            cleaned = EXCESS_NEWLINES_RE.sub("\n\n", cleaned)
        else:
            cleaned = cleaned.replace("\n", " ")
            cleaned = MULTISPACE_RE.sub(" ", cleaned)
        return cleaned.strip()
