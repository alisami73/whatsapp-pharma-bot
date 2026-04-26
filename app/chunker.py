from __future__ import annotations

from collections import Counter
import re
from typing import Dict, Iterable, List, Sequence, Tuple

from .models import Chunk, StructuredDocument, utc_now_iso


STRUCTURE_HEADING_RE = re.compile(r"^(chapitre|section|titre|annexe|partie|livre|باب|قسم|ملحق)\b", re.IGNORECASE)
ARTICLE_START_RE = re.compile(r"^(article|art\.?|المادة|الفصل)\b", re.IGNORECASE)
ARTICLE_NUMBER_RE = re.compile(r"\b(?:article|art\.?|الفصل|المادة)\s+([0-9A-Za-z\-]+)\b", re.IGNORECASE)
REFERENCE_RE = re.compile(r"\b(?:loi|décret|decret|dahir|arrêté|arrete|circulaire|bulletin officiel)\b(?:\s+n[°º]?\s*[0-9\-.]+)?", re.IGNORECASE)
DATE_RE = re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b")
SENTENCE_RE = re.compile(r"(?<=[.!?؛])\s+")
TOKEN_RE = re.compile(r"[\u0600-\u06FFA-Za-zÀ-ÿ0-9][\u0600-\u06FFA-Za-zÀ-ÿ0-9'’\-]{1,}")
STOPWORDS = {
    "avec", "dans", "pour", "sans", "sous", "entre", "après", "avant", "toute", "toutes", "tous",
    "leurs", "leur", "dont", "ainsi", "cette", "celui", "celle", "elles", "ils", "nous", "vous",
    "être", "avoir", "faire", "plus", "moins", "selon", "lorsque", "comme", "toutefois", "chaque",
    "pharmacien", "pharmacie", "article", "section", "chapitre", "titre", "annexe", "المادة", "الفصل",
}


class SemanticChunker:
    """Splits documents into section-aware chunks for RAG."""

    def __init__(self, target_words: int = 320, overlap_words: int = 40) -> None:
        self.target_words = max(120, target_words)
        self.overlap_words = max(0, overlap_words)

    def chunk_document(self, document: StructuredDocument, ocr_score: float) -> List[Chunk]:
        units = self._build_units(document)
        chunks: List[Chunk] = []
        chunk_counter = 1
        for unit in units:
            for content, section_title, page_start, page_end in self._split_unit(unit):
                normalized_section = section_title or document.title or document.source_file
                chunk_id = f"{document.document_id}__chunk_{chunk_counter:03d}"
                keywords = self._extract_keywords(normalized_section, content)
                user_questions = self._build_user_questions(normalized_section, content, keywords)
                chunks.append(
                    Chunk(
                        chunk_id=chunk_id,
                        doc_id=document.document_id,
                        source_file=document.source_file,
                        source_path=document.source_path,
                        page_start=page_start,
                        page_end=page_end,
                        section_title=normalized_section,
                        content=content.strip(),
                        language=document.language,
                        extraction_method=document.extraction_method,
                        ocr_score=ocr_score,
                        created_at=utc_now_iso(),
                        keywords=keywords,
                        user_questions=user_questions,
                        metadata={
                            "document_title": document.title or document.source_file,
                            "word_count": self._word_count(content),
                            "section_path": normalized_section,
                        },
                    )
                )
                chunk_counter += 1
        return chunks

    def _build_units(self, document: StructuredDocument) -> List[Dict[str, object]]:
        units: List[Dict[str, object]] = []
        current_title = document.title or document.source_file
        buffer: List[Tuple[int, str]] = []
        unit_start_page = 1

        for page in document.pages:
            blocks = self._page_blocks(page)
            for block in blocks:
                text = block.strip()
                if not text:
                    continue
                if self._is_heading(text):
                    self._flush_unit(units, current_title, buffer, unit_start_page)
                    current_title = text
                    buffer = []
                    unit_start_page = page.page_number
                    continue
                if self._starts_article(text):
                    self._flush_unit(units, current_title, buffer, unit_start_page)
                    buffer = [(page.page_number, text)]
                    unit_start_page = page.page_number
                    current_title = self._section_title_from_article(current_title, text)
                    continue
                if not buffer:
                    unit_start_page = page.page_number
                buffer.append((page.page_number, text))
            self._flush_buffer_on_page_break(units, current_title, buffer, page.page_number)
            if buffer:
                unit_start_page = buffer[0][0]

        self._flush_unit(units, current_title, buffer, unit_start_page)
        return units

    def _page_blocks(self, page: object) -> List[str]:
        paragraphs = list(getattr(page, "paragraphs", []) or [])
        if paragraphs:
            return paragraphs
        text = getattr(page, "text", "") or ""
        return [part.strip() for part in text.split("\n\n") if part.strip()]

    def _flush_buffer_on_page_break(self, units: List[Dict[str, object]], title: str, buffer: List[Tuple[int, str]], page_number: int) -> None:
        if not buffer:
            return
        word_count = sum(self._word_count(text) for _, text in buffer)
        if word_count > self.target_words * 1.6 and page_number != buffer[0][0]:
            self._flush_unit(units, title, buffer, buffer[0][0])

    def _flush_unit(
        self,
        units: List[Dict[str, object]],
        section_title: str,
        buffer: List[Tuple[int, str]],
        unit_start_page: int,
    ) -> None:
        if not buffer:
            return
        text = "\n\n".join(item[1] for item in buffer if item[1].strip()).strip()
        if not text:
            buffer.clear()
            return
        units.append(
            {
                "section_title": section_title,
                "text": text,
                "page_start": unit_start_page,
                "page_end": buffer[-1][0],
            }
        )
        buffer.clear()

    def _split_unit(self, unit: Dict[str, object]) -> List[Tuple[str, str, int, int]]:
        text = str(unit["text"])
        section_title = str(unit["section_title"])
        page_start = int(unit["page_start"])
        page_end = int(unit["page_end"])
        paragraphs = [part.strip() for part in text.split("\n\n") if part.strip()]
        if self._word_count(text) <= self.target_words * 1.25:
            return [(text, section_title, page_start, page_end)]

        chunks: List[Tuple[str, str, int, int]] = []
        current: List[str] = []
        current_words = 0
        previous_tail = ""
        for paragraph in paragraphs:
            paragraph_words = self._word_count(paragraph)
            if current and current_words + paragraph_words > self.target_words * 1.2:
                chunk_text = "\n\n".join(current).strip()
                chunks.append((chunk_text, section_title, page_start, page_end))
                previous_tail = self._overlap_text(chunk_text)
                current = [previous_tail] if previous_tail else []
                current_words = self._word_count(previous_tail)
            if paragraph_words > self.target_words * 1.4:
                for sentence_chunk in self._split_paragraph(paragraph):
                    if current and current_words + self._word_count(sentence_chunk) > self.target_words * 1.2:
                        chunk_text = "\n\n".join(current).strip()
                        chunks.append((chunk_text, section_title, page_start, page_end))
                        previous_tail = self._overlap_text(chunk_text)
                        current = [previous_tail] if previous_tail else []
                        current_words = self._word_count(previous_tail)
                    current.append(sentence_chunk)
                    current_words += self._word_count(sentence_chunk)
                continue
            current.append(paragraph)
            current_words += paragraph_words
        if current:
            chunks.append(("\n\n".join(current).strip(), section_title, page_start, page_end))
        return chunks

    def _split_paragraph(self, paragraph: str) -> List[str]:
        sentences = [part.strip() for part in SENTENCE_RE.split(paragraph) if part.strip()]
        if len(sentences) <= 1:
            return [paragraph]
        chunks: List[str] = []
        current: List[str] = []
        current_words = 0
        for sentence in sentences:
            sentence_words = self._word_count(sentence)
            if current and current_words + sentence_words > self.target_words:
                chunks.append(" ".join(current))
                current = []
                current_words = 0
            current.append(sentence)
            current_words += sentence_words
        if current:
            chunks.append(" ".join(current))
        return chunks

    def _overlap_text(self, text: str) -> str:
        if self.overlap_words <= 0:
            return ""
        tokens = text.split()
        if len(tokens) <= self.overlap_words:
            return text
        return " ".join(tokens[-self.overlap_words :])

    def _is_heading(self, text: str) -> bool:
        compact = " ".join(text.split())
        if len(compact.split()) > 12:
            return False
        return compact.isupper() or STRUCTURE_HEADING_RE.match(compact) is not None

    def _starts_article(self, text: str) -> bool:
        compact = " ".join(text.split())
        return ARTICLE_START_RE.match(compact) is not None

    def _section_title_from_article(self, current_title: str, article_text: str) -> str:
        first_line = article_text.splitlines()[0].strip()
        if current_title and current_title != first_line:
            return f"{current_title} > {first_line}"
        return first_line

    def _extract_keywords(self, section_title: str, text: str) -> List[str]:
        keywords: List[str] = []
        keywords.extend(match.group(0).strip() for match in ARTICLE_NUMBER_RE.finditer(text))
        keywords.extend(match.group(0).strip() for match in REFERENCE_RE.finditer(text))
        keywords.extend(match.group(0).strip() for match in DATE_RE.finditer(text))
        token_counter = Counter(
            token.lower()
            for token in TOKEN_RE.findall(f"{section_title} {text}")
            if len(token) >= 4 and token.lower() not in STOPWORDS and not token.isdigit()
        )
        keywords.extend(token for token, _ in token_counter.most_common(8))
        unique: List[str] = []
        seen = set()
        for item in keywords:
            normalized = item.lower()
            if normalized in seen:
                continue
            unique.append(item)
            seen.add(normalized)
        return unique[:12]

    def _build_user_questions(self, section_title: str, text: str, keywords: Sequence[str]) -> List[str]:
        questions: List[str] = []
        section = section_title.strip()
        if section:
            questions.append(f"Que dit {section} ?")
        article_ref = next((item for item in keywords if item.lower().startswith(("article", "art.", "art ", "المادة", "الفصل"))), None)
        if article_ref:
            questions.append(f"Que prévoit {article_ref} ?")
        lower = text.lower()
        if any(term in lower for term in ("doit", "doivent", "obligation", "obligatoire", "يلتزم", "يجب")):
            questions.append("Quelles sont les obligations prévues ?")
        if any(term in lower for term in ("sanction", "peine", "amende", "pun", "غرامة", "عقوبة")):
            questions.append("Quelles sanctions sont prévues ?")
        if any(term in lower for term in ("délai", "jours", "mois", "année", "يوم", "أجل")):
            questions.append("Quel est le délai prévu ?")
        return questions[:5]

    def _word_count(self, text: str) -> int:
        return len(TOKEN_RE.findall(text))
