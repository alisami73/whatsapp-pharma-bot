from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional

from .models import StructuredDocument, StructuredPage, detect_language, slugify


class NativePdfExtractor:
    """Extracts text natively from PDF, reusing the repo's Swift extractor when available."""

    def __init__(self, swift_extractor_path: Path, swift_module_cache_path: Optional[Path] = None) -> None:
        self.swift_extractor_path = swift_extractor_path
        self.swift_module_cache_path = swift_module_cache_path or Path("/tmp/swift-module-cache")

    def extract(self, file_path: str, document_id: Optional[str] = None) -> StructuredDocument:
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"Document introuvable: {file_path}")
        doc_id = document_id or slugify(path.stem)

        if path.suffix.lower() == ".txt":
            text = path.read_text(encoding="utf-8")
            page = StructuredPage(page_number=1, text=text, paragraphs=[text], lines=text.splitlines(), extraction_method="native")
            return StructuredDocument(
                document_id=doc_id,
                source_file=path.name,
                source_path=str(path),
                title=path.stem,
                language=detect_language(text),
                page_count=1,
                pages=[page],
                extraction_method="native",
            )

        if self.swift_extractor_path.exists() and shutil.which("swift"):
            swift_document = self._extract_with_swift(path, doc_id)
            if swift_document is not None:
                return swift_document

        return self._extract_with_pypdf(path, doc_id)

    def _extract_with_swift(self, path: Path, doc_id: str) -> Optional[StructuredDocument]:
        self.swift_module_cache_path.mkdir(parents=True, exist_ok=True)
        command = [
            "swift",
            "-module-cache-path",
            str(self.swift_module_cache_path),
            str(self.swift_extractor_path),
            doc_id,
            str(path),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode != 0:
            return None
        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return None
        pages: List[StructuredPage] = []
        aggregate = []
        for item in payload.get("pages", []):
            text = (item.get("text") or "").strip()
            aggregate.append(text)
            pages.append(
                StructuredPage(
                    page_number=int(item.get("page_number", len(pages) + 1)),
                    text=text,
                    lines=[line.strip() for line in text.splitlines() if line.strip()],
                    paragraphs=[part.strip() for part in text.split("\n\n") if part.strip()],
                    extraction_method="native",
                    quality=item.get("quality", "unknown"),
                    warnings=list(item.get("warnings", [])),
                )
            )
        combined_text = "\n\n".join(aggregate)
        return StructuredDocument(
            document_id=payload.get("doc_id", doc_id),
            source_file=payload.get("source_file", path.name),
            source_path=str(path),
            title=payload.get("title") or path.stem,
            language=payload.get("language") or detect_language(combined_text),
            page_count=int(payload.get("page_count", len(pages))),
            pages=pages,
            extraction_method="native",
            warnings=[],
            metadata={"native_extractor": "swift"},
        )

    def _extract_with_pypdf(self, path: Path, doc_id: str) -> StructuredDocument:
        try:
            from pypdf import PdfReader
        except ImportError as exc:  # pragma: no cover - exercised in integration environments
            raise RuntimeError("pypdf est requis pour l'extraction native Python.") from exc

        reader = PdfReader(str(path))
        pages: List[StructuredPage] = []
        aggregate = []
        for index, page in enumerate(reader.pages, start=1):
            text = (page.extract_text() or "").replace("\x00", "").strip()
            aggregate.append(text)
            pages.append(
                StructuredPage(
                    page_number=index,
                    text=text,
                    lines=[line.strip() for line in text.splitlines() if line.strip()],
                    paragraphs=[part.strip() for part in text.split("\n\n") if part.strip()],
                    extraction_method="native",
                    quality="unknown" if text else "low",
                    warnings=["empty_text"] if not text else [],
                )
            )
        combined_text = "\n\n".join(aggregate)
        metadata_title = None
        if reader.metadata:
            metadata_title = getattr(reader.metadata, "title", None) or reader.metadata.get("/Title")
        return StructuredDocument(
            document_id=doc_id,
            source_file=path.name,
            source_path=str(path),
            title=metadata_title or path.stem,
            language=detect_language(combined_text),
            page_count=len(pages),
            pages=pages,
            extraction_method="native",
            warnings=[],
            metadata={"native_extractor": "pypdf"},
        )
