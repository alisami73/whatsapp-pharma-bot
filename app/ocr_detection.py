from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata
from typing import Iterable, List

from .models import OCRQualityResult, StructuredDocument, StructuredPage


NOISY_SYMBOLS = set("�□■▪¤¦§©®™`~<>\\")
WORD_RE = re.compile(r"[\u0600-\u06FFA-Za-zÀ-ÿ0-9][\u0600-\u06FFA-Za-zÀ-ÿ0-9'’\-]{1,}")
REPEATED_RE = re.compile(r"(.)\1{3,}")


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


@dataclass(slots=True)
class OCRHeuristics:
    readable_ratio: float
    abnormal_symbol_ratio: float
    recognized_word_ratio: float
    repeated_char_ratio: float
    empty_page_ratio: float
    low_density_ratio: float
    average_confidence: float
    chars_per_page: float
    total_characters: float


class LowOCRDetector:
    """Heuristic detector for low-quality OCR output."""

    def __init__(self, threshold: float = 0.55) -> None:
        self.threshold = threshold

    def assess(self, document: StructuredDocument | Iterable[StructuredPage]) -> OCRQualityResult:
        pages = list(document.pages if isinstance(document, StructuredDocument) else document)
        if not pages:
            return OCRQualityResult(is_low_ocr=True, score=1.0, reasons=["aucune page exploitable"], metrics={})

        total_visible = 0
        readable_chars = 0
        abnormal_symbols = 0
        total_tokens = 0
        recognized_tokens = 0
        repeated_chars = 0
        empty_pages = 0
        low_density_pages = 0
        confidences: List[float] = []
        total_characters = 0

        for page in pages:
            text = page.text or ""
            stripped = text.strip()
            total_characters += len(stripped)
            if page.ocr_confidence is not None:
                confidences.append(page.ocr_confidence)

            visible_chars = [ch for ch in text if not ch.isspace()]
            visible_count = len(visible_chars)
            total_visible += visible_count
            if visible_count < 40:
                empty_pages += 1

            words = WORD_RE.findall(text)
            total_tokens += len(re.findall(r"\S+", text))
            recognized_tokens += len(words)
            if visible_count < 120 or len(words) < 15:
                low_density_pages += 1

            repeated_chars += sum(len(match.group(0)) for match in REPEATED_RE.finditer(text))

            for ch in visible_chars:
                category = unicodedata.category(ch)
                if ch.isalnum() or ch in ".,;:!?()[]{}%/+-'’\"«»" or "\u0600" <= ch <= "\u06FF":
                    readable_chars += 1
                elif ch in NOISY_SYMBOLS or category.startswith("C"):
                    abnormal_symbols += 1

        page_count = len(pages)
        readable_ratio = readable_chars / max(total_visible, 1)
        abnormal_symbol_ratio = abnormal_symbols / max(total_visible, 1)
        recognized_word_ratio = recognized_tokens / max(total_tokens, 1)
        repeated_char_ratio = repeated_chars / max(total_visible, 1)
        empty_page_ratio = empty_pages / page_count
        low_density_ratio = low_density_pages / page_count
        average_confidence = sum(confidences) / len(confidences) if confidences else 0.75
        chars_per_page = total_characters / page_count

        heuristics = OCRHeuristics(
            readable_ratio=readable_ratio,
            abnormal_symbol_ratio=abnormal_symbol_ratio,
            recognized_word_ratio=recognized_word_ratio,
            repeated_char_ratio=repeated_char_ratio,
            empty_page_ratio=empty_page_ratio,
            low_density_ratio=low_density_ratio,
            average_confidence=average_confidence,
            chars_per_page=chars_per_page,
            total_characters=float(total_characters),
        )

        reasons: List[str] = []
        if page_count >= 2 and chars_per_page < 260:
            reasons.append("texte total très court pour un document multipage")
        if readable_ratio < 0.72:
            reasons.append("ratio de caractères lisibles trop faible")
        if abnormal_symbol_ratio > 0.10:
            reasons.append("présence élevée de symboles anormaux")
        if recognized_word_ratio < 0.62:
            reasons.append("taux de mots reconnus trop faible")
        if repeated_char_ratio > 0.035:
            reasons.append("répétitions anormales de caractères")
        if empty_page_ratio >= 0.34:
            reasons.append("trop de pages quasi vides")
        if low_density_ratio >= 0.5:
            reasons.append("densité textuelle faible sur la majorité des pages")
        if confidences and average_confidence < 0.60:
            reasons.append("confiance OCR moyenne insuffisante")

        score = (
            0.18 * _clamp((260 - chars_per_page) / 260)
            + 0.18 * _clamp((0.82 - readable_ratio) / 0.82)
            + 0.16 * _clamp(abnormal_symbol_ratio / 0.18)
            + 0.16 * _clamp((0.78 - recognized_word_ratio) / 0.78)
            + 0.10 * _clamp(repeated_char_ratio / 0.06)
            + 0.12 * empty_page_ratio
            + 0.06 * low_density_ratio
            + 0.04 * _clamp((0.72 - average_confidence) / 0.72)
        )
        score = round(_clamp(score), 4)

        is_low_ocr = score >= self.threshold or len(reasons) >= 2
        return OCRQualityResult(
            is_low_ocr=is_low_ocr,
            score=score,
            reasons=reasons,
            metrics={
                "readable_ratio": round(heuristics.readable_ratio, 4),
                "abnormal_symbol_ratio": round(heuristics.abnormal_symbol_ratio, 4),
                "recognized_word_ratio": round(heuristics.recognized_word_ratio, 4),
                "repeated_char_ratio": round(heuristics.repeated_char_ratio, 4),
                "empty_page_ratio": round(heuristics.empty_page_ratio, 4),
                "low_density_ratio": round(heuristics.low_density_ratio, 4),
                "average_confidence": round(heuristics.average_confidence, 4),
                "chars_per_page": round(heuristics.chars_per_page, 2),
                "total_characters": heuristics.total_characters,
            },
        )
