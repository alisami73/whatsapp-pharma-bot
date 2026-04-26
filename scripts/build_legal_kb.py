#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = Path("/Users/Lenovo/Documents/2026/Chatbot Whatsapp")

LEGAL_SOURCES_DIR = ROOT / "data" / "legal_sources" / "original_pdfs"
MANUAL_SOURCES_DIR = ROOT / "data" / "legal_sources" / "manual_sources"
LEGAL_KB_DIR = ROOT / "data" / "legal_kb"
RAW_TEXT_DIR = LEGAL_KB_DIR / "raw_text"
NORMALIZED_DIR = LEGAL_KB_DIR / "normalized"
CONSOLIDATED_DIR = LEGAL_KB_DIR / "consolidated"
CHUNKS_DIR = LEGAL_KB_DIR / "chunks"
INDEXES_DIR = LEGAL_KB_DIR / "indexes"
QA_ASSETS_DIR = LEGAL_KB_DIR / "qa_assets"
AUDIT_DIR = LEGAL_KB_DIR / "audit"
PROMPTS_DIR = ROOT / "data" / "prompts"
DOCS_DIR = ROOT / "docs"

SWIFT_EXTRACTOR = ROOT / "scripts" / "extract_pdf_pages.swift"
TARGET_CHUNK_CHARS = 1200
MAX_CHUNK_CHARS = 1800
MIN_CHUNK_CHARS = 350
DRY_RUN = False

DOC_TYPE_RULES = [
    ("loi", "loi"),
    ("décret", "décret"),
    ("decret", "décret"),
    ("circulaire", "circulaire"),
    ("arrêté", "arrêté"),
    ("arrete", "arrêté"),
    ("code de déontologie", "code de déontologie"),
    ("deontologie", "code de déontologie"),
    ("dahir", "dahir"),
    ("bo_", "bulletin officiel"),
    ("bulletin officiel", "bulletin officiel"),
]

TOPIC_RULES = [
    ("ordre", ["ordre des pharmaciens", "gouvernance ordinale", "discipline ordinale"]),
    ("deontologie", ["déontologie", "secret professionnel", "confraternité"]),
    ("officine", ["officine", "ouverture d'officine", "exploitation officinale"]),
    ("absence", ["absence du pharmacien", "remplacement", "responsabilité de l'officine"]),
    ("inspection", ["inspection", "contrôle", "prélèvements", "infractions"]),
    ("hospital", ["pharmacie hospitalière", "approvisionnement", "dispositifs médicaux"]),
    ("equivalence", ["équivalence de diplômes", "autorisation d'exercice", "enseignement supérieur"]),
    ("médicament", ["médicament", "pharmacie", "officine", "établissements pharmaceutiques"]),
    ("medicament", ["médicament", "pharmacie", "officine", "établissements pharmaceutiques"]),
    ("tiers payant", ["tiers payant", "AMO", "prise en charge des médicaments", "convention nationale"]),
    ("amo", ["tiers payant", "AMO", "prise en charge des médicaments"]),
    ("inpe", ["INPE", "tiers payant"]),
    ("anam", ["ANAM", "tiers payant", "convention nationale"]),
    ("صيدلة", ["ordre des pharmaciens", "exercice de la pharmacie", "organisation professionnelle"]),
    ("هيئة", ["ordre des pharmaciens", "organisation professionnelle"]),
]

TOPIC_TRANSLATIONS = {
    "ordre des pharmaciens": ["ordre pharmaciens", "هيئة الصيادلة", "ordre national"],
    "gouvernance ordinale": ["conseil de l'ordre", "مجلس الهيئة"],
    "déontologie": ["code de déontologie", "أخلاقيات المهنة"],
    "secret professionnel": ["secret pro", "السر المهني"],
    "confraternité": ["relations entre pharmaciens", "الزمالة المهنية"],
    "officine": ["pharmacie d'officine", "صيدلية"],
    "ouverture d'officine": ["création officine", "فتح صيدلية"],
    "absence du pharmacien": ["absence officine", "غياب الصيدلي"],
    "remplacement": ["pharmacien remplaçant", "استخلاف"],
    "inspection": ["contrôle", "تفتيش"],
    "pharmacie hospitalière": ["hospital pharmacy", "الصيدلة الاستشفائية"],
    "approvisionnement": ["gestion stock", "التزويد"],
    "équivalence de diplômes": ["equivalence", "معادلة الشهادات"],
    "autorisation d'exercice": ["autorisation", "ترخيص مزاولة"],
    "médicament": ["medicine", "دواء"],
    "établissements pharmaceutiques": ["grossiste", "establishments", "المؤسسات الصيدلية"],
    "tiers payant": ["tiers-payant", "third party payment", "dispense partielle de l'avance des frais"],
    "AMO": ["assurance maladie obligatoire", "amo"],
    "prise en charge des médicaments": ["attestation de prise en charge", "facture de médicaments"],
    "prise en charge des medicaments": ["attestation de prise en charge", "facture de medicaments"],
    "convention nationale": ["convention pharmacien caisses", "ANAM"],
    "INPE": ["identifiant national des professionnels de santé"],
    "ANAM": ["agence nationale de l'assurance maladie"],
}

CONSOLIDATED_SPECS = [
    {
        "filename": "absence_remplacement_pharmacien.md",
        "title": "Absence et remplacement du pharmacien d'officine",
        "keywords": ["absence du pharmacien", "remplacement", "officine"],
        "doc_ids": ["absence_des_pharmaciens_d_officnecirculaire_022202_dr_30_31_du_12_06_1995", "decret_2_63_486_26_12_63_deontologie"],
        "questions": [
            "Un pharmacien peut-il s'absenter de son officine ?",
            "Dans quelles conditions l'officine peut-elle rester ouverte pendant l'absence du titulaire ?",
        ],
    },
    {
        "filename": "ordre_national_des_pharmaciens.md",
        "title": "Ordre national des pharmaciens",
        "keywords": ["ordre des pharmaciens", "gouvernance ordinale", "discipline ordinale"],
        "doc_ids": ["dahir_1_75_453_du_17_12_76_instituant_l_ordre_des_pharmaciens", "bo_7280_fr_ordre_des_pharmaciens_2024", "bo_7278_ar"],
        "questions": [
            "Quel est le rôle de l'Ordre national des pharmaciens ?",
            "Comment sont organisés les conseils de l'ordre ?",
        ],
    },
    {
        "filename": "code_deontologie_pharmaciens.md",
        "title": "Code de déontologie des pharmaciens",
        "keywords": ["déontologie", "secret professionnel", "confraternité"],
        "doc_ids": ["decret_2_63_486_26_12_63_deontologie"],
        "questions": [
            "Quelles sont les principales obligations déontologiques du pharmacien ?",
            "Le pharmacien peut-il modifier une prescription ?",
        ],
    },
    {
        "filename": "pharmacie_hospitaliere_attributions.md",
        "title": "Pharmacie hospitalière et attributions",
        "keywords": ["pharmacie hospitalière", "approvisionnement", "dispositifs médicaux"],
        "doc_ids": ["circulaire_pharmaciens_hospitaliers_prefectoraux_16_dmp_00_du_24_05_2005", "services_pharmacie_hospitaliere_2004_excerpt"],
        "questions": [
            "Quelles sont les attributions du pharmacien hospitalier ?",
            "Qui est responsable de la réception et du stock à l'hôpital ?",
        ],
    },
    {
        "filename": "autorisation_exercice_pharmacien.md",
        "title": "Autorisation d'exercice du pharmacien",
        "keywords": ["autorisation d'exercice", "pharmacie", "ordre des pharmaciens"],
        "doc_ids": ["loi_n_17_04_fr", "dahir_1_75_453_du_17_12_76_instituant_l_ordre_des_pharmaciens", "dahir_1_06_151_du_22_novembre_2006_ar"],
        "questions": [
            "Quelles bases juridiques encadrent l'autorisation d'exercer la pharmacie ?",
            "Quel rôle joue l'ordre dans l'autorisation d'exercice ?",
        ],
    },
    {
        "filename": "equivalence_diplomes_pharmacie.md",
        "title": "Équivalence des diplômes de pharmacie",
        "keywords": ["équivalence de diplômes", "enseignement supérieur", "autorisation d'exercice", "CNOP", "diplôme étranger"],
        "doc_ids": ["decret_2_01_333_du_21_juin_2001_equivalences", "autorisation_exercer_pharmacie"],
        "questions": [
            "Comment demander une équivalence de diplôme étranger de pharmacie ?",
            "Quels compléments peuvent être imposés avant l'équivalence ?",
            "Que faire en cas de rejet d'une demande d'équivalence ?",
            "Quels documents faut-il joindre pour l'équivalence puis l'autorisation d'exercer ?",
        ],
    },
    {
        "filename": "inspection_et_controle.md",
        "title": "Inspection et contrôle pharmaceutiques",
        "keywords": ["inspection", "contrôle", "prélèvements", "infractions"],
        "doc_ids": ["decret_2_18_878_du_8_septembre_2021_controle_pharmaciens_inspecteurs", "loi_n_17_04_fr"],
        "questions": [
            "Comment se déroule une inspection pharmaceutique ?",
            "Quels actes de contrôle et de prélèvement sont prévus ?",
        ],
    },
    {
        "filename": "ouverture_officine_conditions.md",
        "title": "Conditions d'ouverture d'une officine",
        "keywords": ["ouverture d'officine", "officine", "autorisation d'exercice"],
        "doc_ids": ["decret_5646_fr_relatif_a_l_ouverture_d_officine", "loi_n_17_04_fr", "normes_technique"],
        "questions": [
            "Quelles sont les conditions d'ouverture d'une officine ?",
            "Quels textes faut-il vérifier pour la création d'une officine ?",
        ],
    },
    {
        "filename": "tiers_payant_amo_officine.md",
        "title": "Tiers payant AMO en officine",
        "keywords": ["tiers payant", "AMO", "prise en charge des médicaments", "convention nationale", "INPE", "ANAM"],
        "doc_ids": ["tiers_payant_2016"],
        "questions": [
            "Comment fonctionne le tiers payant AMO en pharmacie ?",
            "Quels documents et identifiants le pharmacien doit-il vérifier avant l'envoi d'un dossier tiers payant ?",
        ],
    },
]

PAGE_SELECTIONS: Dict[str, List[int]] = {
    "bo_7026_ar_inspection": [7, 8, 9, 10],
}

DOC_METADATA_OVERRIDES: Dict[str, Dict[str, Any]] = {
    "loi_n_17_04_fr": {
        "official_title": "Loi n° 17-04 portant code du médicament et de la pharmacie",
        "short_title": "Loi n° 17-04 code du médicament et de la pharmacie",
        "document_type": "loi",
        "legal_domain": "droit pharmaceutique marocain",
    },
    "bo_7026_ar_inspection": {
        "official_title": "مرسوم رقم 2.18.878 صادر في 30 من محرم 1443 (8 سبتمبر 2021) يتعلق بكيفيات ممارسة المراقبة من طرف الصيادلة المفتشين",
        "document_type": "décret",
        "language": "ar",
    },
    "normes_technique": {
        "official_title": "Arrêté du ministre de la santé n° 902-08 du 17 rejeb 1429 (21 juillet 2008) fixant les normes techniques d'installation, de salubrité et de surface relatives au local devant abriter une officine de pharmacie ainsi que les normes techniques relatives aux établissements pharmaceutiques",
        "short_title": "Arrêté n° 902-08 normes techniques officine et établissements pharmaceutiques",
        "document_type": "arrêté",
        "language": "fr",
        "topics": [
            "officine",
            "ouverture d'officine",
            "exploitation officinale",
            "médicament",
            "pharmacie",
            "établissements pharmaceutiques",
        ],
        "legal_domain": "officine et exercice privé",
    },
}

RELATIONSHIP_OVERRIDES: Dict[str, Dict[str, Any]] = {
    "bo_7026_ar_inspection": {
        "parallel_version_of": "decret_2_18_878_du_8_septembre_2021_controle_pharmaciens_inspecteurs",
        "parallel_version_confidence": "high",
    },
    "bo_7278_ar": {
        "parallel_version_of": "bo_7280_fr_ordre_des_pharmaciens_2024",
        "parallel_version_confidence": "low",
    },
    "decret_2_18_878_du_8_septembre_2021_controle_pharmaciens_inspecteurs": {
        "parallel_version_of": "bo_7026_ar_inspection",
        "parallel_version_confidence": "high",
    },
    "bo_7280_fr_ordre_des_pharmaciens_2024": {
        "parallel_version_of": "bo_7278_ar",
        "parallel_version_confidence": "low",
    },
}


def ensure_dirs() -> None:
    for path in [
        LEGAL_SOURCES_DIR,
        MANUAL_SOURCES_DIR,
        RAW_TEXT_DIR,
        NORMALIZED_DIR,
        CONSOLIDATED_DIR,
        CHUNKS_DIR,
        INDEXES_DIR,
        QA_ASSETS_DIR,
        AUDIT_DIR,
        PROMPTS_DIR,
        DOCS_DIR,
    ]:
        path.mkdir(parents=True, exist_ok=True)


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    asciiish = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    asciiish = asciiish.replace("°", " ").replace("º", " ")
    slug = re.sub(r"[^0-9A-Za-z\u0600-\u06FF]+", "_", asciiish.lower()).strip("_")
    return re.sub(r"_+", "_", slug)


def clean_filename_title(filename: str) -> str:
    base = Path(filename).stem
    base = re.sub(r"\s+", " ", base.replace("_", " ")).strip()
    return base


def to_ascii_doc_id(path: Path) -> str:
    return slugify(clean_filename_title(path.name))


def normalize_whitespace(text: str) -> str:
    text = text.replace("\u00a0", " ").replace("\u200f", "").replace("\u200e", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def string_or_empty(value: Any) -> str:
    return "" if value is None else str(value)


def sha256_text(text: str) -> str:
    return hashlib.sha256(string_or_empty(text).encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> Optional[str]:
    try:
        if not path.exists() or not path.is_file():
            return None
        hasher = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                hasher.update(chunk)
        return hasher.hexdigest()
    except OSError:
        return None


def first_non_empty_lines(text: str, limit: int = 8) -> List[str]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines[:limit]


def detect_doc_type(name: str, text: str) -> str:
    normalized_name = clean_filename_title(name).lower()
    if normalized_name.startswith("loi ") or normalized_name.startswith("loi n"):
        return "loi"
    if normalized_name.startswith("decret") or normalized_name.startswith("décret"):
        return "décret"
    if normalized_name.startswith("dahir"):
        return "dahir"

    combined = f"{name} {text[:1200]}".lower()
    for needle, label in DOC_TYPE_RULES:
        if needle in combined:
            return label
    return "autre"


def infer_topics(name: str, text: str) -> List[str]:
    combined = f"{name} {text[:6000]}".lower()
    topics: List[str] = []
    for needle, values in TOPIC_RULES:
        if needle in combined:
            for value in values:
                if value not in topics:
                    topics.append(value)
    if not topics:
        topics.append("pharmacie")
    return topics


def quality_summary(pages: List[Dict[str, Any]]) -> Tuple[str, Any, str, bool]:
    if not pages:
        return "unknown", "probable", "low", True

    empty_pages = sum(1 for page in pages if not page.get("text", "").strip())
    low_pages = sum(1 for page in pages if page.get("quality") == "low")
    medium_pages = sum(1 for page in pages if page.get("quality") == "medium")
    high_pages = sum(1 for page in pages if page.get("quality") == "high")
    total = len(pages)

    empty_ratio = empty_pages / total
    low_ratio = low_pages / total

    if empty_ratio >= 0.6:
        is_scan = True
    elif empty_ratio >= 0.2 or low_ratio >= 0.5:
        is_scan = "probable"
    else:
        is_scan = False

    if high_pages / total >= 0.7 and low_pages == 0:
        ocr_quality = "high"
    elif low_ratio >= 0.5 or empty_ratio >= 0.3:
        ocr_quality = "low"
    else:
        ocr_quality = "medium"

    needs_review = bool(is_scan) or ocr_quality == "low" or medium_pages == total
    return ocr_quality, is_scan, f"{high_pages} high / {medium_pages} medium / {low_pages} low", needs_review


def detect_title(extracted_title: Optional[str], text: str, filename: str) -> str:
    bad_titles = {
        "untitled",
        "ocr document",
        "pdfcreator, job 4",
        "microsoft word - document1",
        "microsoft word - document4",
        "microsoft word - arrêtébest.docx",
        "microsoft word - arretebest.docx",
    }
    if extracted_title and extracted_title.strip().lower() not in bad_titles:
        return extracted_title.strip()

    lines = first_non_empty_lines(text, limit=12)
    title_candidates: List[str] = []
    for line in lines:
        if re.search(r"(dahir|décret|decret|loi|circulaire|ظهير|مرسوم|قانون|المادة)", line, re.IGNORECASE):
            title_candidates.append(line)
        elif title_candidates:
            title_candidates.append(line)
        if len(title_candidates) >= 2:
            break
    if title_candidates:
        return normalize_whitespace(" ".join(title_candidates))[:300]
    return clean_filename_title(filename)


def extract_publication_reference(text: str, filename: str) -> str:
    segment = text[:2000]
    patterns = [
        r"B\.?O\.?\s*N[°º]?\s*[0-9]+[^\n]*",
        r"Référence\s*:\s*[^\n]+",
        r"REFERENCE\s*:\s*[^\n]+",
        r"عدد\s+[0-9٠-٩]+[^\n]*",
        r"Bulletin officiel[^\n]*",
    ]
    for pattern in patterns:
        match = re.search(pattern, segment, re.IGNORECASE)
        if match:
            return normalize_whitespace(match.group(0))
    if filename.lower().startswith("bo_"):
        return clean_filename_title(filename)
    return "unknown"


def extract_date_values(text: str, filename: str) -> Tuple[Optional[str], Optional[str]]:
    segment = text[:2500]
    gregorian_patterns = [
        r"\((\d{1,2}\s+[A-Za-zéûîôàèùêçÉÛÎÔÀÈÙÊÇ]+\s+\d{4})\)",
        r"(\d{1,2}\s+[A-Za-zéûîôàèùêçÉÛÎÔÀÈÙÊÇ]+\s+\d{4})",
        r"(\d{2}[-/]\d{2}[-/]\d{2,4})",
    ]
    hijri_patterns = [
        r"(\d{1,2}\s+[A-Za-zéûîôàèùêçÉÛÎÔÀÈÙÊÇ]+\s+1\d{3})",
        r"(\d{1,2}\s+[اأإآء-ي]+\s+1\d{3})",
        r"(\d{1,2}\s+[اأإآء-ي]+\s+14\d{2})",
    ]
    gregorian = None
    hijri = None
    for pattern in gregorian_patterns:
        match = re.search(pattern, segment)
        if match:
            gregorian = match.group(1)
            break
    for pattern in hijri_patterns:
        match = re.search(pattern, segment)
        if match:
            hijri = match.group(1)
            break

    if not gregorian:
        filename_match = re.search(r"(\d{2}[-_]\d{2}[-_]\d{2,4})", filename)
        if filename_match:
            gregorian = filename_match.group(1).replace("_", "-")
    return hijri, gregorian


def issuing_authority(text: str, doc_type: str) -> str:
    segment = text[:2500]
    rules = [
        (r"LE PREMIER MINISTRE", "Premier ministre"),
        (r"Le Premier ministre", "Premier ministre"),
        (r"Le Ministre de la Santé", "Ministre de la Santé"),
        (r"Ministère de La santé", "Ministère de la Santé"),
        (r"Notre Majest[ée]", "Autorité royale"),
        (r"Grand Sceau", "Autorité royale"),
        (r"رئيس الحكومة", "رئيس الحكومة"),
        (r"وزير الصحة", "وزارة الصحة"),
        (r"جلالة الملك", "السلطة الملكية"),
    ]
    for pattern, label in rules:
        if re.search(pattern, segment, re.IGNORECASE):
            return label
    if doc_type == "circulaire":
        return "Ministère de la Santé"
    return "unknown"


def detect_legal_domain(topics: List[str]) -> str:
    if "déontologie" in topics:
        return "déontologie pharmaceutique"
    if "ordre des pharmaciens" in topics:
        return "ordre professionnel pharmaceutique"
    if "pharmacie hospitalière" in topics:
        return "pharmacie hospitalière"
    if "équivalence de diplômes" in topics:
        return "accès à la profession / équivalence"
    if "inspection" in topics:
        return "inspection et contrôle pharmaceutiques"
    if "officine" in topics or "ouverture d'officine" in topics:
        return "officine et exercice privé"
    return "droit pharmaceutique marocain"


def relationship_metadata(doc_id: str) -> Dict[str, Any]:
    return dict(RELATIONSHIP_OVERRIDES.get(doc_id, {}))


def relationship_metadata_from_overrides(doc_id: str, overrides: Dict[str, Any]) -> Dict[str, Any]:
    merged = relationship_metadata(doc_id)
    for key in ["parallel_version_of", "parallel_version_confidence", "duplicate_of", "duplicate_group"]:
        if overrides.get(key) is not None:
            merged[key] = overrides[key]
    return merged


def selected_pages_for_doc(doc_id: str, pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    selected_numbers = PAGE_SELECTIONS.get(doc_id)
    if not selected_numbers:
        return pages
    selected_set = set(selected_numbers)
    return [page for page in pages if page["page_number"] in selected_set]


def document_overrides(doc_id: str) -> Dict[str, Any]:
    return dict(DOC_METADATA_OVERRIDES.get(doc_id, {}))


def load_manual_source(path: Path) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    doc_id = payload.get("doc_id") or to_ascii_doc_id(path)
    sections = payload.get("sections", [])
    pages: List[Dict[str, Any]] = []
    for index, section in enumerate(sections, start=1):
        title = normalize_whitespace(section.get("title", f"Section {index}"))
        body = normalize_whitespace(section.get("text", ""))
        page_text = f"{title}\n{body}".strip()
        warnings = list(section.get("warnings", []))
        if "[lien]" in page_text.lower():
            warnings.append("placeholder_links_unresolved")
        page_number = int(section.get("page_number", index))
        pages.append(
            {
                "page_number": page_number,
                "text": page_text,
                "extraction_method": "manual_text",
                "quality": "high" if body else "low",
                "warnings": sorted(set(warnings)),
                "keywords": list(section.get("keywords", [])),
                "user_questions": list(section.get("user_questions", [])),
                "category": section.get("category"),
                "source_pages": list(section.get("source_pages", [page_number])),
                "text_sha256": sha256_text(page_text),
            }
        )

    extraction = {
        "doc_id": doc_id,
        "source_file": str(path),
        "language": payload.get("language", "unknown"),
        "page_count": len(pages),
        "title": payload.get("official_title") or payload.get("detected_title"),
        "pages": pages,
    }
    overrides = {
        key: value
        for key, value in payload.items()
        if key != "sections"
    }
    return extraction, overrides


def load_existing_normalized_overrides(doc_id: str) -> Dict[str, Any]:
    path = NORMALIZED_DIR / f"{doc_id}.json"
    if not path.exists():
        return {}

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    allowed = {
        "official_title",
        "short_title",
        "document_type",
        "jurisdiction",
        "language",
        "publication_reference",
        "date_hijri",
        "date_gregorian",
        "effective_date",
        "issuing_authority",
        "legal_domain",
        "topics",
        "status",
        "summary",
        "manual_review_required",
        "warnings",
        "notes",
        "version",
    }
    return {key: payload[key] for key in allowed if key in payload}


def load_existing_raw_pages(path: Path) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    doc_id = payload.get("doc_id") or path.stem.replace(".pages", "")
    pages = payload.get("pages", [])

    extraction = {
        "doc_id": doc_id,
        "source_file": payload.get("source_file") or str(path),
        "language": payload.get("language", "unknown"),
        "page_count": payload.get("source_page_count") or payload.get("page_count") or len(pages),
        "title": None,
        "pages": pages,
    }

    overrides = {
        "referenced_source_file": payload.get("referenced_source_file"),
        **load_existing_normalized_overrides(doc_id),
        **document_overrides(doc_id),
    }
    return extraction, overrides


def normalize_digits(value: str) -> str:
    if value is None:
        return value
    trans = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
    return value.translate(trans)


def structure_parse(pages: List[Dict[str, Any]], language: str) -> Dict[str, List[Dict[str, Any]]]:
    titles: List[Dict[str, Any]] = []
    chapters: List[Dict[str, Any]] = []
    sections: List[Dict[str, Any]] = []
    articles: List[Dict[str, Any]] = []

    title_patterns = [
        re.compile(r"^\s*TITRE\s+([IVXLC\d]+(?:er)?)\s*(.*)$", re.IGNORECASE),
        re.compile(r"^\s*الباب\s+([^\s:]+)\s*(.*)$"),
    ]
    chapter_patterns = [
        re.compile(r"^\s*CHAPITRE\s+([IVXLC\d]+(?:er)?)\s*(.*)$", re.IGNORECASE),
        re.compile(r"^\s*الفصل\s+([^\s:]+)\s*(.*)$"),
    ]
    section_patterns = [
        re.compile(r"^\s*(SECTION|SOUS-SECTION)\s+([IVXLC\d]+)\s*(.*)$", re.IGNORECASE),
        re.compile(r"^\s*(القسم|الفرع|المبحث)\s+([^\s:]+)\s*(.*)$"),
    ]
    article_patterns = [
        re.compile(r"^\s*(?:ARTICLE|ART\.)\s*(premier|1er|\d+)\s*[:.\-]", re.IGNORECASE),
        re.compile(r"^\s*Article\s+(premier|1er|\d+)\s*[:.\-]", re.IGNORECASE),
        re.compile(r"^\s*المادة\s+([0-9٠-٩]+)"),
    ]

    def add_unique(bucket: List[Dict[str, Any]], label: str, page_number: int, extra: Dict[str, Any] | None = None) -> None:
        if not label:
            return
        if any(item["label"] == label and item["page"] == page_number for item in bucket):
            return
        payload = {"label": label, "page": page_number}
        if extra:
            payload.update(extra)
        bucket.append(payload)

    for page in pages:
        for line in page["text"].splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            for pattern in title_patterns:
                match = pattern.match(stripped)
                if match:
                    label = normalize_whitespace(" ".join(part for part in match.groups() if part))
                    add_unique(titles, label, page["page_number"])
                    break
            for pattern in chapter_patterns:
                match = pattern.match(stripped)
                if match:
                    label = normalize_whitespace(" ".join(part for part in match.groups() if part))
                    add_unique(chapters, label, page["page_number"])
                    break
            for pattern in section_patterns:
                match = pattern.match(stripped)
                if match:
                    label = normalize_whitespace(" ".join(part for part in match.groups() if part))
                    add_unique(sections, label, page["page_number"])
                    break
            for pattern in article_patterns:
                match = pattern.match(stripped)
                if match:
                    raw_num = match.group(1)
                    art_num = normalize_digits(raw_num)
                    add_unique(
                        articles,
                        f"Article {art_num}" if language != "ar" else f"المادة {art_num}",
                        page["page_number"],
                        {"article_number": art_num},
                    )
                    break

    return {
        "titres": titles,
        "chapitres": chapters,
        "sections": sections,
        "articles": articles,
    }


def extract_cross_references(text: str) -> List[str]:
    refs: List[str] = []
    patterns = [
        r"article\s+(premier|1er|\d+)",
        r"art\.\s*(premier|1er|\d+)",
        r"المادة\s+([0-9٠-٩]+)",
        r"loi\s+n[°º]?\s*[\d\.-]+",
        r"dahir\s+n[°º]?\s*[\d\.-]+",
        r"décret\s+n[°º]?\s*[\d\.-]+",
        r"مرسوم\s+رقم\s+[\d\.-]+",
        r"ظهير\s+شريف\s+رقم\s+[\d\.-]+",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            ref = normalize_whitespace(match.group(0))
            if ref not in refs:
                refs.append(ref)
    return refs[:20]


def extract_sentences(text: str) -> List[str]:
    clean = normalize_whitespace(text)
    if not clean:
        return []
    sentences = re.split(r"(?<=[\.\!\؟\?;])\s+|\n+", clean)
    return [s.strip() for s in sentences if s.strip()]


def build_retrieval_keywords(meta: Dict[str, Any], text: str, structure_path: str, article_number: Optional[str]) -> List[str]:
    keywords = set()
    for value in meta.get("topics", []):
        keywords.add(value)
        for translated in TOPIC_TRANSLATIONS.get(value, []):
            keywords.add(translated)
    for token in re.findall(r"[A-Za-zÀ-ÿ\u0600-\u06FF]{3,}", meta.get("short_title", "")):
        keywords.add(token.lower())
    for token in re.findall(r"[A-Za-zÀ-ÿ\u0600-\u06FF]{3,}", structure_path):
        keywords.add(token.lower())
    if article_number:
        keywords.add(f"article {article_number}")
        keywords.add(f"المادة {article_number}")
    for token in re.findall(r"[A-Za-zÀ-ÿ\u0600-\u06FF]{4,}", text[:300]):
        keywords.add(token.lower())
    return sorted(keyword for keyword in keywords if keyword and len(keyword) <= 80)[:30]


def make_chunk_summary(text: str) -> str:
    sentences = extract_sentences(text)
    if not sentences:
        return "Texte source peu exploitable ; résumé prudent impossible sans relecture humaine."
    return sentences[0][:400]


def extract_key_lines(text: str, patterns: List[str], limit: int = 3) -> List[str]:
    sentences = extract_sentences(text)
    matches = []
    for sentence in sentences:
        lower = sentence.lower()
        if any(re.search(pattern, lower, re.IGNORECASE) for pattern in patterns):
            matches.append(sentence[:400])
        if len(matches) >= limit:
            break
    return matches


def extract_entities(text: str, meta: Dict[str, Any]) -> List[str]:
    entities = []

    for value in [meta.get("official_title"), meta.get("issuing_authority"), meta.get("document_type")]:
        if value and value not in entities:
            entities.append(value)

    patterns = [
        r"\b(?:CNSS|CNDP|ANAM|AMO|INPE)\b",
        r"\b(?:Ordre des pharmaciens|Conseil national|Minist[eè]re de la sant[eé])\b",
        r"\b(?:loi|dahir|decret|décret|arr[eê]t[eé])\s*(?:n[°º]?\s*)?[\d\.-]+",
        r"مرسوم\s+رقم\s+[\d\.-]+",
        r"ظهير(?:\s+شريف)?\s+رقم\s+[\d\.-]+",
    ]

    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            entity = normalize_whitespace(match.group(0))
            if entity not in entities:
                entities.append(entity)

    return entities[:20]


def extract_deadlines(text: str) -> List[str]:
    deadlines = []
    patterns = [
        r"\b(?:dans un d[eé]lai de|avant le|au plus tard dans un d[eé]lai de)\s+[^.;:\n]{0,80}",
        r"\b\d+\s+(?:jour|jours|mois|ans|ann[eé]es)\b[^.;:\n]{0,40}",
        r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b",
        r"\b\d{1,2}\s+[A-Za-zéûîôàèùêç]+\s+\d{4}\b",
    ]

    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            deadline = normalize_whitespace(match.group(0))
            if deadline not in deadlines:
                deadlines.append(deadline)

    return deadlines[:8]


def extract_obligations(text: str) -> List[str]:
    return extract_key_lines(
        text,
        [
            r"\bdoit\b",
            r"\bdoivent\b",
            r"\best tenu\b",
            r"\best tenue\b",
            r"\bil est obligatoire\b",
            r"\bobligatoirement\b",
            r"يجب",
            r"يلتزم",
            r"يتعين",
        ],
        limit=5,
    )


def detect_chunk_type(text: str, article_number: Optional[str], structure_state: Dict[str, Optional[str]], subchunk_count: int) -> str:
    cleaned = normalize_whitespace(text).lower()
    first_line = normalize_whitespace(text.splitlines()[0] if text.splitlines() else text).lower()

    if first_line.startswith("annexe") or first_line.startswith("ملحق"):
        return "annex"
    if article_number and subchunk_count > 1:
        return "article_part"
    if article_number:
        return "article"
    if any(structure_state.get(key) for key in ("title", "chapter", "section")):
        return "section"
    return "preamble"


def is_semantic_boundary(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False

    patterns = [
        r"^\d+[\.\)]\s+",
        r"^[A-Za-z]\)\s+",
        r"^[IVXLCMivxlcm]+\)\s+",
        r"^[•\-]\s+",
        r"^(?:paragraphe|sous-section|section|chapitre|titre|annexe)\b",
        r"^(?:الباب|الفصل|القسم|الفرع|المبحث|ملحق)\b",
    ]

    if any(re.match(pattern, stripped, re.IGNORECASE) for pattern in patterns):
        return True

    return stripped.endswith(":")


def split_segment_by_sentences(lines: List[str], header_line: Optional[str]) -> List[List[str]]:
    if not lines:
        return []

    body_lines = list(lines)
    if header_line and body_lines and normalize_whitespace(body_lines[0]) == normalize_whitespace(header_line):
        body_lines = body_lines[1:]

    sentences = extract_sentences("\n".join(body_lines))
    if not sentences:
        return [lines]

    chunks = []
    current = [header_line] if header_line else []
    current_length = sum(len(item) for item in current)

    for sentence in sentences:
        projected = current_length + len(sentence) + 1
        if current and projected > MAX_CHUNK_CHARS and current_length >= TARGET_CHUNK_CHARS:
            chunks.append([item for item in current if item])
            current = [header_line] if header_line else []
            current_length = sum(len(item) for item in current)

        current.append(sentence)
        current_length += len(sentence) + 1

    if current:
        chunks.append([item for item in current if item])

    return chunks or [lines]


def semantic_split_buffer_lines(buffer_lines: List[str], article_number: Optional[str]) -> List[List[str]]:
    lines = [normalize_whitespace(line) for line in buffer_lines if normalize_whitespace(line)]
    if not lines:
        return []

    full_text_length = len("\n".join(lines))
    if full_text_length <= TARGET_CHUNK_CHARS:
        return [lines]

    header_line = lines[0] if article_number else None
    segments: List[List[str]] = []
    current: List[str] = []
    current_length = 0

    for index, line in enumerate(lines):
        boundary = index > 0 and is_semantic_boundary(line)
        projected_length = current_length + len(line) + 1

        if current and (
            (boundary and current_length >= MIN_CHUNK_CHARS)
            or (projected_length > MAX_CHUNK_CHARS and current_length >= TARGET_CHUNK_CHARS)
        ):
            segments.append(current)
            current = [header_line] if header_line else []
            current_length = sum(len(item) + 1 for item in current)

        if header_line and current and line == header_line and current == [header_line]:
            continue

        current.append(line)
        current_length += len(line) + 1

    if current:
        segments.append(current)

    refined_segments: List[List[str]] = []
    for segment in segments:
        if len("\n".join(segment)) > MAX_CHUNK_CHARS:
            refined_segments.extend(split_segment_by_sentences(segment, header_line))
        else:
            refined_segments.append(segment)

    return refined_segments


def chunk_from_lines(
    chunks: List[Dict[str, Any]],
    *,
    doc_meta: Dict[str, Any],
    buffer_lines: List[str],
    page_start: int,
    page_end: int,
    structure_state: Dict[str, Optional[str]],
    article_number: Optional[str],
    chunk_index: int,
    confidence: str,
    manual_review: bool,
    extra_metadata: Optional[Dict[str, Any]] = None,
) -> int:
    subchunks = semantic_split_buffer_lines(buffer_lines, article_number)
    if not subchunks:
        return 0

    structure_parts = [value for value in [structure_state.get("title"), structure_state.get("chapter"), structure_state.get("section")] if value]
    if article_number:
        structure_parts.append(f"Article {article_number}" if doc_meta["language"] != "ar" else f"المادة {article_number}")
    elif not structure_parts:
        structure_parts.append("unnamed_section")
    structure_path = " > ".join(structure_parts)

    for offset, lines in enumerate(subchunks):
        text = "\n".join(lines).strip()
        if not text:
            continue

        clean_text = normalize_whitespace(text)
        current_chunk_index = chunk_index + offset
        chunk_id = f"{doc_meta['doc_id']}__chunk_{current_chunk_index:03d}"
        key_rules = extract_key_lines(text, [r"\bdoit\b", r"\best\b", r"\binterdit\b", r"\bne peut\b", r"يجب", r"يمنع", r"لا يجوز"])
        exceptions = extract_key_lines(text, [r"\bsauf\b", r"\btoutefois\b", r"\bexcept", r"إلا", r"غير أن"])
        sanctions = extract_key_lines(text, [r"\bsanction\b", r"\bamende\b", r"\bsuspension\b", r"\bradiation\b", r"\bretrait\b", r"غرامة", r"عقوبة"])
        definitions = extract_key_lines(text, [r"on entend par", r"est défini", r"au sens de la présente loi", r"يقصد", r"تعني"])
        obligations = extract_obligations(text)
        deadlines = extract_deadlines(text)
        citations = extract_cross_references(text)
        entities = extract_entities(text, doc_meta)
        chunk_type = detect_chunk_type(text, article_number, structure_state, len(subchunks))
        keywords = build_retrieval_keywords(doc_meta, text, structure_path, article_number)
        if extra_metadata:
            keywords = list(dict.fromkeys(keywords + list(extra_metadata.get("keywords", []))))
        user_questions = list(dict.fromkeys(list((extra_metadata or {}).get("user_questions", []))))
        citation_core = f"{doc_meta['short_title']}, {structure_path}"
        if article_number:
            citation_core = f"{citation_core}, art. {article_number}"
        citation_label = f"{citation_core}, p. {page_start}" if page_start == page_end else f"{citation_core}, p. {page_start}-{page_end}"

        chunks.append(
            {
                "metadata_schema_version": 2,
                "chunk_id": chunk_id,
                "chunk_sequence": offset + 1,
                "chunk_total_in_unit": len(subchunks),
                "chunk_type": chunk_type,
                "source_document": doc_meta["official_title"],
                "source_document_kind": doc_meta.get("source_document_kind", "pdf"),
                "document_id": doc_meta["doc_id"],
                "doc_id": doc_meta["doc_id"],
                "source_file": doc_meta["source_file"],
                "referenced_source_file": doc_meta.get("referenced_source_file"),
                "source_sha256": doc_meta.get("source_sha256"),
                "content_sha256": sha256_text(clean_text),
                "language": doc_meta["language"],
                "document_type": doc_meta["document_type"],
                "official_title": doc_meta["official_title"],
                "title": doc_meta["official_title"],
                "short_title": doc_meta["short_title"],
                "jurisdiction": doc_meta.get("jurisdiction", "Maroc"),
                "publication_reference": doc_meta.get("publication_reference"),
                "publication_date": doc_meta.get("publication_date") or doc_meta.get("date_gregorian"),
                "effective_date": doc_meta.get("effective_date") or doc_meta.get("date_gregorian"),
                "version": doc_meta.get("version") or doc_meta.get("publication_reference") or "unknown",
                "topic_tags": doc_meta["topics"],
                "topics": doc_meta["topics"],
                "keywords": keywords,
                "structure_path": structure_path,
                "section_path": structure_path,
                "article_number": article_number,
                "page_start": page_start,
                "page_end": page_end,
                "text": text,
                "clean_text": clean_text,
                "legal_summary": make_chunk_summary(text),
                "key_rules": key_rules,
                "exceptions": exceptions,
                "sanctions": sanctions,
                "definitions": definitions,
                "entities": entities,
                "obligations": obligations,
                "deadlines": deadlines,
                "citations": citations,
                "cross_references": citations,
                "retrieval_keywords": keywords,
                "keywords": keywords,
                "user_questions": user_questions,
                "category": (extra_metadata or {}).get("category"),
                "citation_label": citation_label,
                "confidence": confidence,
                "manual_review_required": manual_review,
                "parallel_version_of": doc_meta.get("parallel_version_of"),
                "parallel_version_confidence": doc_meta.get("parallel_version_confidence"),
            }
        )
    return len(subchunks)


def build_chunks(pages: List[Dict[str, Any]], doc_meta: Dict[str, Any]) -> List[Dict[str, Any]]:
    article_patterns = [
        re.compile(r"^\s*(?:ARTICLE|ART\.)\s*(premier|1er|\d+)\s*[:.\-]", re.IGNORECASE),
        re.compile(r"^\s*Article\s+(premier|1er|\d+)\s*[:.\-]", re.IGNORECASE),
        re.compile(r"^\s*المادة\s+([0-9٠-٩]+)"),
    ]
    title_patterns = [
        re.compile(r"^\s*TITRE\s+([IVXLC\d]+(?:er)?)\s*(.*)$", re.IGNORECASE),
        re.compile(r"^\s*الباب\s+([^\s:]+)\s*(.*)$"),
    ]
    chapter_patterns = [
        re.compile(r"^\s*CHAPITRE\s+([IVXLC\d]+(?:er)?)\s*(.*)$", re.IGNORECASE),
        re.compile(r"^\s*الفصل\s+([^\s:]+)\s*(.*)$"),
    ]
    section_patterns = [
        re.compile(r"^\s*(SECTION|SOUS-SECTION)\s+([IVXLC\d]+)\s*(.*)$", re.IGNORECASE),
        re.compile(r"^\s*(القسم|الفرع|المبحث)\s+([^\s:]+)\s*(.*)$"),
    ]

    structure_state = {"title": None, "chapter": None, "section": None}
    chunks: List[Dict[str, Any]] = []
    buffer_lines: List[str] = []
    page_start = 1
    page_end = 1
    article_number: Optional[str] = None
    buffer_extra_metadata: Optional[Dict[str, Any]] = None
    chunk_index = 1
    found_article = False

    doc_manual = doc_meta["manual_review_required"]
    doc_confidence = "low" if doc_meta["ocr_quality"] == "low" else "medium" if doc_meta["ocr_quality"] == "medium" else "high"

    for page in pages:
        lines = page["text"].splitlines()
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            title_match = next((pattern.match(stripped) for pattern in title_patterns if pattern.match(stripped)), None)
            if title_match:
                structure_state["title"] = normalize_whitespace(" ".join(part for part in title_match.groups() if part))

            chapter_match = next((pattern.match(stripped) for pattern in chapter_patterns if pattern.match(stripped)), None)
            if chapter_match:
                structure_state["chapter"] = normalize_whitespace(" ".join(part for part in chapter_match.groups() if part))

            section_match = next((pattern.match(stripped) for pattern in section_patterns if pattern.match(stripped)), None)
            if section_match:
                structure_state["section"] = normalize_whitespace(" ".join(part for part in section_match.groups() if part))

            article_match = next((pattern.match(stripped) for pattern in article_patterns if pattern.match(stripped)), None)
            if article_match:
                found_article = True
                if buffer_lines:
                    added_chunks = chunk_from_lines(
                        chunks,
                        doc_meta=doc_meta,
                        buffer_lines=buffer_lines,
                        page_start=page_start,
                        page_end=page_end,
                        structure_state=structure_state,
                        article_number=article_number,
                        chunk_index=chunk_index,
                        confidence=doc_confidence,
                        manual_review=doc_manual,
                        extra_metadata=buffer_extra_metadata,
                    )
                    chunk_index += max(added_chunks, 1)
                article_number = normalize_digits(article_match.group(1))
                buffer_lines = [stripped]
                page_start = page["page_number"]
                page_end = page["page_number"]
                buffer_extra_metadata = {
                    "keywords": list(page.get("keywords", [])),
                    "user_questions": list(page.get("user_questions", [])),
                    "category": page.get("category"),
                }
                continue

            if buffer_lines:
                buffer_lines.append(stripped)
                page_end = page["page_number"]
            else:
                buffer_lines = [stripped]
                page_start = page["page_number"]
                page_end = page["page_number"]
                buffer_extra_metadata = {
                    "keywords": list(page.get("keywords", [])),
                    "user_questions": list(page.get("user_questions", [])),
                    "category": page.get("category"),
                }

    if buffer_lines:
        added_chunks = chunk_from_lines(
            chunks,
            doc_meta=doc_meta,
            buffer_lines=buffer_lines,
            page_start=page_start,
            page_end=page_end,
            structure_state=structure_state,
            article_number=article_number,
            chunk_index=chunk_index,
            confidence=doc_confidence,
            manual_review=doc_manual,
            extra_metadata=buffer_extra_metadata,
        )
        chunk_index += max(added_chunks, 1)

    if found_article:
        return chunks

    fallback_chunks: List[Dict[str, Any]] = []
    chunk_index = 1
    for page in pages:
        text = page["text"].strip()
        if not text:
            continue
        added_chunks = chunk_from_lines(
            fallback_chunks,
            doc_meta=doc_meta,
            buffer_lines=[text],
            page_start=page["page_number"],
            page_end=page["page_number"],
            structure_state={"title": None, "chapter": None, "section": None},
            article_number=None,
            chunk_index=chunk_index,
            confidence="low" if page["quality"] == "low" else doc_confidence,
            manual_review=doc_manual or page["quality"] != "high",
            extra_metadata={
                "keywords": list(page.get("keywords", [])),
                "user_questions": list(page.get("user_questions", [])),
                "category": page.get("category"),
            },
        )
        chunk_index += max(added_chunks, 1)
    return fallback_chunks


def write_json(path: Path, payload: Any) -> None:
    if DRY_RUN:
        return
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_markdown(path: Path, content: str) -> None:
    if DRY_RUN:
        return
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def run_extractor(doc_id: str, pdf_path: Path) -> Dict[str, Any]:
    env = os.environ.copy()
    env["CLANG_MODULE_CACHE_PATH"] = "/tmp/swift-clang-cache"
    result = subprocess.run(
        ["swift", str(SWIFT_EXTRACTOR), doc_id, str(pdf_path)],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Extraction failed for {pdf_path.name}: {result.stderr}")

    stdout = result.stdout.strip()
    start = stdout.find("{")
    if start == -1:
        raise RuntimeError(f"Unexpected extractor output for {pdf_path.name}: {stdout[:300]}")
    return json.loads(stdout[start:])


def create_raw_markdown(record: Dict[str, Any], official_title: str) -> str:
    lines = [
        f"# {official_title}",
        "",
        f"- doc_id: `{record['doc_id']}`",
        f"- source_file: `{record['source_file']}`",
        f"- language: `{record['language']}`",
        f"- page_count: `{len(record['pages'])}`",
        "",
    ]
    for page in record["pages"]:
        lines.extend(
            [
                f"## Page {page['page_number']}",
                "",
                f"- extraction_method: `{page['extraction_method']}`",
                f"- quality: `{page['quality']}`",
                f"- warnings: {', '.join(page['warnings']) if page['warnings'] else 'none'}",
                "",
                page["text"].rstrip() or "_[aucun texte extrait]_",
                "",
            ]
        )
    return "\n".join(lines)


def source_notes(record: Dict[str, Any], title: str, quality_state: Tuple[str, Any, str, bool]) -> List[str]:
    ocr_quality, is_scan, ratio_text, needs_review = quality_state
    notes = [f"ratios pages: {ratio_text}"]
    if record.get("title") and record["title"].strip().lower() != "untitled":
        notes.append(f"metadata title={record['title']}")
    if is_scan:
        notes.append("scan probable ou partiel")
    if ocr_quality == "low":
        notes.append("texte faible / OCR non satisfaisant")
    if needs_review:
        notes.append("revue humaine recommandée")
    if title == clean_filename_title(Path(record["source_file"]).name):
        notes.append("titre détecté depuis le nom de fichier")
    return notes


def confidence_from_quality(ocr_quality: str, manual_review: bool) -> str:
    if manual_review or ocr_quality == "low":
        return "low"
    if ocr_quality == "medium":
        return "medium"
    return "high"


def quote_chunk(chunk: Dict[str, Any]) -> str:
    if not chunk:
        return ""
    return f"- {chunk['legal_summary']} [{chunk['citation_label']}]"


def select_chunks(chunks: List[Dict[str, Any]], spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    wanted_doc_ids = list(spec.get("doc_ids", []))
    wanted_ids = set(wanted_doc_ids)
    wanted_order = {doc_id: index for index, doc_id in enumerate(wanted_doc_ids)}
    keywords = [kw.lower() for kw in spec.get("keywords", [])]
    direct_matches = [chunk for chunk in chunks if chunk["doc_id"] in wanted_ids]
    results = direct_matches
    if not results:
        for chunk in chunks:
            haystack = " ".join([chunk["structure_path"], chunk["clean_text"], " ".join(chunk["topic_tags"])]).lower()
            if any(keyword in haystack for keyword in keywords):
                results.append(chunk)
    unique = []
    seen = set()
    for chunk in sorted(
        results,
        key=lambda item: (
            item["doc_id"] not in wanted_ids,
            wanted_order.get(item["doc_id"], len(wanted_order)),
            item["manual_review_required"],
            item["page_start"],
            item["chunk_id"],
        ),
    ):
        if chunk["chunk_id"] not in seen:
            unique.append(chunk)
            seen.add(chunk["chunk_id"])
    return unique[:12]


def build_consolidated_doc(spec: Dict[str, Any], selected_chunks: List[Dict[str, Any]]) -> str:
    title = spec["title"]
    reliable = [chunk for chunk in selected_chunks if not chunk["manual_review_required"]]
    uncertain = [chunk for chunk in selected_chunks if chunk["manual_review_required"]]

    summary_lines = [quote_chunk(chunk) for chunk in reliable[:3] if quote_chunk(chunk)]
    if not summary_lines:
        summary_lines = [quote_chunk(chunk) for chunk in selected_chunks[:3] if quote_chunk(chunk)]
    if not summary_lines and uncertain:
        summary_lines.append("- Les sources identifiées sont partiellement exploitables ; une relecture humaine reste recommandée.")

    key_rules = []
    conditions = []
    procedures = []
    sanctions = []
    source_lines = []
    uncertainty_lines = []
    keywords = set(spec.get("keywords", []))

    for chunk in selected_chunks:
        source_lines.append(f"- `{chunk['source_file']}` — {chunk['citation_label']}")
        keywords.update(chunk["retrieval_keywords"][:8])
        for sentence in chunk["key_rules"]:
            if sentence not in key_rules:
                key_rules.append(f"- {sentence} [{chunk['citation_label']}]")
        for sentence in chunk["exceptions"]:
            if sentence not in conditions:
                conditions.append(f"- {sentence} [{chunk['citation_label']}]")
        if re.search(r"\b(procéd|demande|autorisation|transmet|soumet|reçoit|préside|établit)\b", chunk["clean_text"], re.IGNORECASE):
            if chunk["legal_summary"] not in procedures:
                procedures.append(f"- {chunk['legal_summary']} [{chunk['citation_label']}]")
        for sentence in chunk["sanctions"]:
            if sentence not in sanctions:
                sanctions.append(f"- {sentence} [{chunk['citation_label']}]")
        if chunk["manual_review_required"]:
            uncertainty_lines.append(f"- Chunk `{chunk['chunk_id']}` à faible confiance ({chunk['citation_label']}).")

    if not conditions:
        conditions.append("- Aucune exception explicite n’a été isolée avec un niveau de confiance suffisant dans les sources retenues.")
    if not procedures:
        procedures.append("- Les procédures détaillées doivent être vérifiées dans les textes sources cités ; aucun workflow complet n’a été reconstruit automatiquement.")
    if not sanctions:
        sanctions.append("- Aucun passage de sanction n’a été isolé avec suffisamment de confiance dans les extraits retenus.")
    if not uncertainty_lines:
        uncertainty_lines.append("- Aucun point d’incertitude majeur relevé sur les chunks retenus à ce stade.")

    questions = "\n".join(f"- {question}" for question in spec.get("questions", []))
    keywords_line = ", ".join(sorted(keywords)[:20])

    return "\n".join(
        [
            f"# {title}",
            "",
            "## Résumé opérationnel",
            *summary_lines,
            "",
            "## Règles principales",
            *(key_rules or ["- Aucune règle suffisamment nette n’a été synthétisée automatiquement."]),
            "",
            "## Conditions / exceptions",
            *conditions,
            "",
            "## Procédures",
            *procedures,
            "",
            "## Sanctions / risques",
            *sanctions,
            "",
            "## Textes sources",
            *source_lines,
            "",
            "## Points d’incertitude",
            *uncertainty_lines,
            "",
            "## Mots-clés de recherche",
            keywords_line,
            "",
            "## Questions utilisateur typiques",
            questions,
            "",
        ]
    )


def build_faq_seed(chunks: List[Dict[str, Any]], consolidated_files: List[str], doc_map: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    templates = [
        ("Un pharmacien peut-il s’absenter de son officine ?", "fr", "absence_officine"),
        ("Dans quelles conditions l’officine peut-elle rester ouverte en l’absence du titulaire ?", "fr", "absence_officine"),
        ("Quel est le rôle de l’Ordre national des pharmaciens ?", "fr", "ordre"),
        ("Quelles sont les principales obligations déontologiques du pharmacien ?", "fr", "deontologie"),
        ("Quelles sont les attributions du pharmacien hospitalier ?", "fr", "hospital"),
        ("Comment demander une équivalence de diplôme ?", "fr", "equivalence"),
        ("Quelles sont les bases juridiques de l’inspection pharmaceutique ?", "fr", "inspection"),
        ("Quelles sont les conditions d’ouverture d’une officine ?", "fr", "officine"),
        ("Comment fonctionne le tiers payant AMO en pharmacie ?", "fr", "tiers_payant"),
        ("Quels documents le pharmacien doit-il vérifier avant l’envoi d’un dossier tiers payant ?", "fr", "tiers_payant"),
        ("هل يمكن للصيدلي أن يغيب عن صيدليته؟", "ar", "absence_officine"),
        ("ما هو دور الهيئة الوطنية للصيادلة؟", "ar", "ordre"),
        ("ما هي أهم قواعد أخلاقيات مهنة الصيدلة؟", "ar", "deontologie"),
        ("ما هي مهام الصيدلي بالمستشفى؟", "ar", "hospital"),
        ("كيف تتم معادلة الشهادات العليا؟", "ar", "equivalence"),
        ("ما هي قواعد التفتيش والرقابة الصيدلية؟", "ar", "inspection"),
        ("ما شروط فتح الصيدلية؟", "ar", "officine"),
    ]

    intent_map = {
        "absence_officine": "absence_remplacement",
        "ordre": "ordre_des_pharmaciens",
        "deontologie": "deontologie",
        "hospital": "pharmacie_hospitaliere",
        "equivalence": "equivalence",
        "inspection": "inspection",
        "officine": "ouverture_officine",
        "tiers_payant": "tiers_payant_amo",
    }

    topic_map = {
        "absence_officine": "absence et remplacement du pharmacien",
        "ordre": "ordre national des pharmaciens",
        "deontologie": "déontologie pharmaceutique",
        "hospital": "pharmacie hospitalière",
        "equivalence": "équivalence de diplômes",
        "inspection": "inspection et contrôle",
        "officine": "ouverture d'officine",
        "tiers_payant": "tiers payant AMO",
    }

    def relevant_chunks_for(bucket: str) -> List[Dict[str, Any]]:
        keywords = {
            "absence_officine": ["absence", "remplacement", "officine"],
            "ordre": ["ordre", "conseil", "pharmaciens"],
            "deontologie": ["déontologie", "secret", "profession"],
            "hospital": ["hospital", "hospitalière", "hôpital", "stock", "distribution", "service de pharmacie"],
            "equivalence": ["équivalence", "diplôme", "commission"],
            "inspection": ["inspection", "contrôle", "prélèvements"],
            "officine": ["officine", "ouverture", "création"],
            "tiers_payant": ["tiers payant", "amo", "prise en charge", "inpe", "anam", "convention"],
        }[bucket]
        preferred_doc_ids = {
            "hospital": {
                "circulaire_pharmaciens_hospitaliers_prefectoraux_16_dmp_00_du_24_05_2005",
                "services_pharmacie_hospitaliere_2004_excerpt",
            },
            "tiers_payant": {"tiers_payant_2016"},
        }.get(bucket, set())
        selected = []
        for chunk in chunks:
            haystack = " ".join([chunk["clean_text"], chunk["structure_path"], " ".join(chunk["topic_tags"])]).lower()
            if any(keyword in haystack for keyword in keywords):
                selected.append(chunk)
        selected = sorted(
            selected,
            key=lambda item: (
                item["doc_id"] not in preferred_doc_ids,
                item["manual_review_required"],
                item["page_start"],
                item["chunk_id"],
            ),
        )
        return selected[:4]

    for question, language, bucket in templates:
        rel_chunks = relevant_chunks_for(bucket)
        citations = [chunk["citation_label"] for chunk in rel_chunks]
        relevant_doc_ids = sorted({chunk["doc_id"] for chunk in rel_chunks})
        relevant_chunk_ids = [chunk["chunk_id"] for chunk in rel_chunks]
        if rel_chunks:
            draft = " ".join(chunk["legal_summary"] for chunk in rel_chunks[:2])
        else:
            draft = "Aucun fondement suffisamment pertinent n’a été isolé automatiquement dans la base actuelle."
        risk = "high" if any(chunk["manual_review_required"] for chunk in rel_chunks) or bucket in {"inspection", "officine", "tiers_payant"} else "medium"
        entries.append(
            {
                "question": question,
                "language": language,
                "intent": intent_map[bucket],
                "topic": topic_map[bucket],
                "relevant_doc_ids": relevant_doc_ids,
                "relevant_chunk_ids": relevant_chunk_ids,
                "gold_answer_draft": draft,
                "citations": citations,
                "risk_level": risk,
                "needs_human_validation": True,
            }
        )
    return entries


def build_guidelines() -> str:
    return """# Règles de gouvernance du chatbot juridique

## Principes obligatoires
- Répondre uniquement à partir des sources indexées dans `data/legal_kb/`.
- Toujours citer les textes et, si possible, les pages / articles utilisés.
- Distinguer dans chaque réponse :
  1. réponse simplifiée ;
  2. fondement juridique ;
  3. limites / incertitudes.
- Ne jamais inventer un article, un numéro de page ou une sanction.
- Ne jamais prétendre qu’un texte est en vigueur si l’état du document est `unknown`.
- Distinguer les textes normatifs officiels des sources opérationnelles ou secondaires ajoutées manuellement ; ne pas présenter ces dernières comme un texte réglementaire.

## Politique de citation
- Mentionner au minimum le `citation_label` du ou des chunks retenus.
- Lorsque plusieurs textes se complètent, citer chaque source séparément.
- En cas de conflit apparent entre textes, ne pas arbitrer sans base explicite : signaler le conflit et recommander une vérification humaine.

## Gestion des documents OCRisés ou dégradés
- Si `manual_review_required=true` ou si `ocr_quality=low`, indiquer explicitement que la source est partiellement incertaine.
- En cas de texte illisible ou d’extraction vide, répondre qu’aucun fondement exploitable n’a été retrouvé dans la base actuelle.
- Si la source a été fournie manuellement et contient des liens placeholders ou une référence non vérifiée, le dire explicitement.

## Questions hors périmètre
- Si la question est hors des thèmes couverts (ordre, officines, déontologie, inspection, pharmacie hospitalière, exercice, équivalence), le signaler clairement.
- Ne pas extrapoler à d’autres professions de santé sans source explicite.

## Stratégie de réponse
- Chercher d’abord des chunks lexicalement et vectoriellement proches.
- Prioriser les chunks à `confidence=high`.
- Ajouter les chunks `medium/low` uniquement si aucun meilleur support n’existe, en signalant l’incertitude.

## Sortie recommandée
1. Réponse simplifiée.
2. Fondement juridique (citations).
3. Limites / incertitudes.
4. Recommandation de vérification humaine si nécessaire.
"""


def build_readme() -> str:
    return """# README_KB

## Architecture produite
- `data/legal_sources/original_pdfs/` : références (symlinks) vers les PDF originaux.
- `data/legal_sources/manual_sources/` : sources textuelles manuelles structurées et traçables.
- `data/legal_kb/raw_text/` : extraction brute page par page (`.raw.md`, `.pages.json`).
- `data/legal_kb/normalized/` : fiches documentaires normalisées.
- `data/legal_kb/chunks/` : segments juridiques prêts pour RAG.
- `data/legal_kb/consolidated/` : synthèses métier prudentes et sourcées.
- `data/legal_kb/qa_assets/` : graines Q/R bilingues.
- `data/legal_kb/indexes/` : inventaires et index globaux.
- `data/legal_kb/audit/` : incidents d’extraction, revue humaine, doublons.
- `data/prompts/` : prompts système et prompts de synthèse pour le pipeline RAG.
- `docs/` : documentation d’exploitation et garde-fous du chatbot.

## Limites
- Certains PDF arabes sont scannés ou très dégradés ; leur exploitation reste partielle.
- L’OCR natif local n’a pas permis d’améliorer de façon fiable tous les scans.
- Les synthèses consolidées restent prudentes et peuvent signaler des points à vérifier.
- Les sources textuelles manuelles doivent être distinguées des textes normatifs officiels et peuvent nécessiter une vérification complémentaire.

## Branchement embeddings / retrieval
Stratégie recommandée :
1. ingestion des `chunks/*.chunks.json` dans un index vectoriel ;
2. index lexical parallèle (BM25 / full-text) sur `clean_text`, `retrieval_keywords`, `structure_path`, `citation_label` ;
3. reranking des candidats ;
4. answer synthesis avec citations vers `citation_label`, `source_file`, `page_start/page_end`.

## Confiance documentaire
- `ocr_quality=high` : texte nativement exploitable, confiance élevée.
- `ocr_quality=medium` : exploitable avec prudence.
- `ocr_quality=low` : utiliser uniquement avec avertissement et vérification humaine.

## Stratégie chatbot recommandée
1. Retrieval lexical + vectoriel.
2. Reranking.
3. Answer synthesis avec citations.
4. Application stricte des garde-fous juridiques définis dans `docs/chatbot_legal_guidelines.md`.
"""


def build_prompt_file() -> str:
    return """# Legal RAG System Prompt

Vous êtes un assistant juridique spécialisé en droit pharmaceutique marocain.

Règles :
- Répondez uniquement à partir des sources indexées.
- Citez toujours les `citation_label`.
- Signalez explicitement toute incertitude, OCR faible, conflit ou source incomplète.
- Ne donnez pas d’avis définitif si la base est incomplète.
- Si aucun fondement n’est trouvé, dites-le clairement.
"""


def duplicate_candidates(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    duplicates = []
    by_clean_name: Dict[str, List[str]] = defaultdict(list)
    for record in records:
        name = clean_filename_title(Path(record["source_file"]).name)
        normalized = re.sub(r"\(\d+\)", "", name).strip().lower()
        by_clean_name[normalized].append(record["doc_id"])

    for key, values in by_clean_name.items():
        if len(values) > 1:
            page_counts = {
                doc_ids_record["doc_id"]: doc_ids_record["page_count"]
                for doc_ids_record in records
                if doc_ids_record["doc_id"] in values
            }
            confidence = "high" if len(set(page_counts.values())) == 1 else "low"
            payload = {
                "reason": "same_filename_variant",
                "normalized_name": key,
                "doc_ids": values,
                "confidence": confidence,
            }
            if confidence != "high":
                payload["notes"] = "Les fichiers portent un nom proche mais n'ont pas le même nombre de pages ; un doublon exact n'est pas établi."
            duplicates.append(
                payload
            )

    candidate_pairs = []
    doc_ids = {record["doc_id"]: record for record in records}
    if "bo_7280_fr_ordre_des_pharmaciens_2024" in doc_ids and "bo_7278_ar" in doc_ids:
        candidate_pairs.append(
            {
                "reason": "possible_parallel_ar_fr_versions",
                "doc_ids": ["bo_7280_fr_ordre_des_pharmaciens_2024", "bo_7278_ar"],
                "confidence": "low",
                "notes": "Les deux documents semblent concerner l’ordre / الهيئة الوطنية للصيادلة en 2024, mais l’alignement n’a pas été vérifié manuellement.",
            }
        )
    duplicates.extend(candidate_pairs)
    return duplicates


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build or reindex the local legal KB.")
    parser.add_argument("--source-dir", default=str(SOURCE_DIR), help="Directory containing source PDFs.")
    parser.add_argument("--prefer-existing-raw", action="store_true", help="Reuse data/legal_kb/raw_text/*.pages.json when available.")
    parser.add_argument("--dry-run", action="store_true", help="Compute the KB pipeline without writing files.")
    return parser.parse_args(argv)


def main() -> int:
    global DRY_RUN

    args = parse_args()
    DRY_RUN = bool(args.dry_run)
    ensure_dirs()
    source_dir = Path(args.source_dir)
    pdf_files = sorted(source_dir.glob("*.pdf")) if source_dir.exists() else []
    existing_raw_files = sorted(RAW_TEXT_DIR.glob("*.pages.json"))
    manual_source_files = sorted(MANUAL_SOURCES_DIR.glob("*.json"))
    use_existing_raw = bool(args.prefer_existing_raw and existing_raw_files)

    if not pdf_files and not manual_source_files and not existing_raw_files:
        print("No PDF files found.", file=sys.stderr)
        return 1

    records: List[Dict[str, Any]] = []
    extraction_issues: List[Dict[str, Any]] = []
    manual_review_queue: List[Dict[str, Any]] = []
    built_normalized: Dict[str, Dict[str, Any]] = {}
    built_chunks_by_doc: Dict[str, List[Dict[str, Any]]] = {}

    manual_doc_ids = {
        json.loads(path.read_text(encoding="utf-8")).get("doc_id") or to_ascii_doc_id(path)
        for path in manual_source_files
    }

    source_items = []
    if use_existing_raw:
        for raw_path in existing_raw_files:
            doc_id = raw_path.stem.replace(".pages", "")
            if doc_id not in manual_doc_ids:
                source_items.append(("raw", raw_path))
    else:
        source_items.extend([("pdf", pdf) for pdf in pdf_files])
    source_items.extend([("manual", path) for path in manual_source_files])

    for source_kind, source_path in source_items:
        if source_kind == "pdf":
            pdf = source_path
            doc_id = to_ascii_doc_id(pdf)
            extraction = run_extractor(doc_id, pdf)
            link_target = LEGAL_SOURCES_DIR / pdf.name
            try:
                if link_target.exists() or link_target.is_symlink():
                    if link_target.is_symlink() and link_target.resolve() == pdf.resolve():
                        pass
                    else:
                        link_target.unlink()
                if not link_target.exists():
                    os.symlink(pdf, link_target)
            except FileExistsError:
                pass
            overrides = {
                **load_existing_normalized_overrides(doc_id),
                **document_overrides(doc_id),
            }
            source_file = pdf
        elif source_kind == "manual":
            extraction, manual_overrides = load_manual_source(source_path)
            doc_id = extraction["doc_id"]
            link_target = source_path
            overrides = {**manual_overrides, **document_overrides(doc_id)}
            source_file = source_path
        else:
            extraction, raw_overrides = load_existing_raw_pages(source_path)
            doc_id = extraction["doc_id"]
            link_target = Path(raw_overrides.get("referenced_source_file") or extraction["source_file"])
            overrides = raw_overrides
            source_file = Path(extraction["source_file"])

        processing_pages = selected_pages_for_doc(doc_id, extraction["pages"])
        source_name = source_file.name
        relationships = relationship_metadata_from_overrides(doc_id, overrides)
        referenced_source_file = str(overrides.get("referenced_source_file") or link_target)
        referenced_source_path = Path(referenced_source_file)
        hash_target = referenced_source_path if referenced_source_path.exists() else source_file
        source_sha256 = sha256_file(hash_target)
        content_sha256 = sha256_text("\n\n".join(page["text"] for page in processing_pages))

        ocr_quality, is_scan, ratio_text, needs_review = quality_summary(processing_pages)
        first_pages_text = "\n".join(page["text"] for page in processing_pages[:5])
        official_title = overrides.get("official_title", detect_title(extraction.get("title"), first_pages_text, source_name))
        document_type = overrides.get("document_type", detect_doc_type(source_name, first_pages_text))
        topics = overrides.get(
            "topics",
            infer_topics(source_name, first_pages_text + "\n" + "\n".join(page["text"][:800] for page in processing_pages[5:10])),
        )
        if source_kind == "manual":
            hijri_date = overrides.get("date_hijri")
            gregorian_date = overrides.get("date_gregorian")
            publication_ref = overrides.get("publication_reference", "unknown")
            issuer = overrides.get("issuing_authority", "unknown")
        else:
            hijri_date, gregorian_date = extract_date_values(first_pages_text, source_name)
            publication_ref = overrides.get("publication_reference", extract_publication_reference(first_pages_text, source_name))
            issuer = overrides.get("issuing_authority", issuing_authority(first_pages_text, document_type))
        language = overrides.get("language", extraction["language"])
        source_document_kind = "manual" if source_kind == "manual" else "pdf"
        structure = structure_parse(processing_pages, language)
        needs_review = bool(overrides.get("manual_review_required", needs_review))
        effective_date = overrides.get("effective_date", gregorian_date)

        notes = source_notes(extraction, official_title, (ocr_quality, is_scan, ratio_text, needs_review))
        notes.extend(overrides.get("notes", []))
        notes = list(dict.fromkeys(notes))
        if doc_id in PAGE_SELECTIONS:
            selected = ",".join(str(num) for num in PAGE_SELECTIONS[doc_id])
            notes.append(f"traitement ciblé sur les pages source [{selected}]")
        detected_title = overrides.get("detected_title", official_title)
        source_record = {
            "doc_id": doc_id,
            "source_file": str(source_file),
            "referenced_source_file": referenced_source_file,
            "source_sha256": source_sha256,
            "content_sha256": content_sha256,
            "detected_title": detected_title,
            "source_document_kind": source_document_kind,
            "document_type": document_type,
            "language": language,
            "is_scan": is_scan,
            "ocr_quality": ocr_quality,
            "page_count": extraction["page_count"],
            "needs_manual_review": needs_review,
            "notes": notes,
        }
        source_record.update(relationships)
        records.append(source_record)

        pages_payload = {
            "doc_id": doc_id,
            "source_file": str(source_file),
            "referenced_source_file": referenced_source_file,
            "source_sha256": source_sha256,
            "content_sha256": content_sha256,
            "language": language,
            "page_count": len(processing_pages),
            "source_page_count": extraction["page_count"],
            "selected_source_pages": [page["page_number"] for page in processing_pages],
            "pages": processing_pages,
        }
        write_json(RAW_TEXT_DIR / f"{doc_id}.pages.json", pages_payload)
        write_markdown(
            RAW_TEXT_DIR / f"{doc_id}.raw.md",
            create_raw_markdown(
                {
                    **pages_payload,
                    "pages": processing_pages,
                },
                official_title,
            ),
        )

        normalized_payload = {
            "metadata_schema_version": 2,
            "source_document": official_title,
            "source_document_kind": source_document_kind,
            "document_id": doc_id,
            "doc_id": doc_id,
            "source_file": str(source_file),
            "referenced_source_file": referenced_source_file,
            "source_sha256": source_sha256,
            "content_sha256": content_sha256,
            "official_title": official_title,
            "title": official_title,
            "short_title": overrides.get("short_title", clean_filename_title(source_name)[:160]),
            "document_type": document_type,
            "jurisdiction": "Maroc",
            "language": language,
            "publication_reference": publication_ref,
            "publication_date": gregorian_date,
            "date_hijri": hijri_date,
            "date_gregorian": gregorian_date,
            "effective_date": effective_date,
            "issuing_authority": issuer,
            "legal_domain": overrides.get("legal_domain", detect_legal_domain(topics)),
            "topics": topics,
            "keywords": build_retrieval_keywords({
                "topics": topics,
                "short_title": overrides.get("short_title", clean_filename_title(source_name)[:160]),
            }, first_pages_text, official_title, None),
            "entities": extract_entities(first_pages_text, {
                "official_title": official_title,
                "issuing_authority": issuer,
                "document_type": document_type,
            }),
            "deadlines": extract_deadlines(first_pages_text),
            "citations": extract_cross_references(first_pages_text),
            "version": overrides.get("version") or publication_ref or "unknown",
            "status": overrides.get("status", "in_force" if "maintenu en vigueur" in first_pages_text.lower() else "unknown"),
            "summary": overrides.get("summary", make_chunk_summary(first_pages_text) if not needs_review else f"Document identifié comme « {official_title} ». Extraction partielle ou bruitée ; la synthèse doit être vérifiée sur le texte source."),
            "structure": structure if any(structure.values()) else {
                "titres": [],
                "chapitres": [],
                "sections": [{"label": "unnamed_section", "page": 1}],
                "articles": [],
            },
            "source_pages": [page["page_number"] for page in processing_pages],
            "ocr_quality": ocr_quality,
            "manual_review_required": needs_review,
            "cross_references": extract_cross_references(first_pages_text),
            "warnings": notes,
        }
        normalized_payload.update(relationships)
        write_json(NORMALIZED_DIR / f"{doc_id}.json", normalized_payload)
        built_normalized[doc_id] = normalized_payload

        chunks = build_chunks(processing_pages, normalized_payload)
        write_json(CHUNKS_DIR / f"{doc_id}.chunks.json", {"doc_id": doc_id, "chunks": chunks})
        built_chunks_by_doc[doc_id] = chunks

        doc_issues = []
        low_pages = []
        for page in processing_pages:
            if page["quality"] != "high" or page["warnings"]:
                low_pages.append(
                    {
                        "page_number": page["page_number"],
                        "quality": page["quality"],
                        "warnings": page["warnings"],
                        "extraction_method": page["extraction_method"],
                    }
                )
        if low_pages:
            doc_issues.append(
                {
                    "doc_id": doc_id,
                    "source_file": str(source_file),
                    "referenced_source_file": referenced_source_file,
                    "ocr_quality": ocr_quality,
                    "is_scan": is_scan,
                    "pages": low_pages,
                }
            )
            extraction_issues.extend(doc_issues)
        if not chunks:
            extraction_issues.append(
                {
                    "doc_id": doc_id,
                    "source_file": str(source_file),
                    "referenced_source_file": referenced_source_file,
                    "ocr_quality": ocr_quality,
                    "is_scan": is_scan,
                    "issue": "no_retrievable_chunks_generated",
                }
            )
        if needs_review:
            manual_review_queue.append(
                {
                    "doc_id": doc_id,
                    "source_file": str(source_file),
                    "referenced_source_file": referenced_source_file,
                    "reason": notes,
                    "priority": "high" if ocr_quality == "low" else "medium",
                }
            )

    records.sort(key=lambda item: item["doc_id"])
    write_json(INDEXES_DIR / "source_inventory.json", records)

    all_normalized = {}
    all_chunks: List[Dict[str, Any]] = []
    for record in records:
        doc_id = record["doc_id"]
        norm_payload = built_normalized.get(doc_id)
        if norm_payload is None and (NORMALIZED_DIR / f"{doc_id}.json").exists():
            norm_payload = json.loads((NORMALIZED_DIR / f"{doc_id}.json").read_text(encoding="utf-8"))
        if norm_payload is None:
            continue
        all_normalized[doc_id] = norm_payload
        chunk_list = built_chunks_by_doc.get(doc_id)
        if chunk_list is None and (CHUNKS_DIR / f"{doc_id}.chunks.json").exists():
            chunk_payload = json.loads((CHUNKS_DIR / f"{doc_id}.chunks.json").read_text(encoding="utf-8"))
            chunk_list = chunk_payload["chunks"]
        if chunk_list:
            all_chunks.extend(chunk_list)

    consolidated_files = []
    for spec in CONSOLIDATED_SPECS:
        selected = select_chunks(all_chunks, spec)
        content = build_consolidated_doc(spec, selected)
        path = CONSOLIDATED_DIR / spec["filename"]
        write_markdown(path, content)
        consolidated_files.append(str(path.relative_to(ROOT)))

    faq_seed = build_faq_seed(all_chunks, consolidated_files, all_normalized)
    write_json(QA_ASSETS_DIR / "faq_seed.json", faq_seed)

    duplicates = duplicate_candidates(records)
    write_json(AUDIT_DIR / "duplicate_candidates.json", duplicates)
    write_json(AUDIT_DIR / "extraction_issues.json", extraction_issues)
    write_json(AUDIT_DIR / "manual_review_queue.json", manual_review_queue)

    by_theme: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"documents": [], "chunks": []})
    by_language: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"documents": [], "chunks": []})
    by_doc_type: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"documents": [], "chunks": []})

    for record in records:
        for topic in all_normalized[record["doc_id"]]["topics"]:
            by_theme[topic]["documents"].append(record["doc_id"])
        by_language[record["language"]]["documents"].append(record["doc_id"])
        by_doc_type[record["document_type"]]["documents"].append(record["doc_id"])

    for chunk in all_chunks:
        for topic in chunk["topic_tags"]:
            by_theme[topic]["chunks"].append(chunk["chunk_id"])
        by_language[chunk["language"]]["chunks"].append(chunk["chunk_id"])
        by_doc_type[chunk["document_type"]]["chunks"].append(chunk["chunk_id"])

    knowledge_index = {
        "documents": [
            {
                "doc_id": record["doc_id"],
                "official_title": all_normalized[record["doc_id"]]["official_title"],
                "language": record["language"],
                "document_type": record["document_type"],
                "source_file": record["source_file"],
                "referenced_source_file": record.get("referenced_source_file"),
                "source_sha256": record.get("source_sha256"),
                "content_sha256": record.get("content_sha256"),
                "normalized_file": f"data/legal_kb/normalized/{record['doc_id']}.json",
                "chunks_file": f"data/legal_kb/chunks/{record['doc_id']}.chunks.json",
                "parallel_version_of": all_normalized[record["doc_id"]].get("parallel_version_of"),
                "parallel_version_confidence": all_normalized[record["doc_id"]].get("parallel_version_confidence"),
                "duplicate_of": all_normalized[record["doc_id"]].get("duplicate_of"),
            }
            for record in records
        ],
        "chunks": [
            {
                "chunk_id": chunk["chunk_id"],
                "doc_id": chunk["doc_id"],
                "citation_label": chunk["citation_label"],
                "language": chunk["language"],
                "topic_tags": chunk["topic_tags"],
                "confidence": chunk["confidence"],
                "manual_review_required": chunk["manual_review_required"],
                "content_sha256": chunk.get("content_sha256"),
            }
            for chunk in all_chunks
        ],
        "consolidated_files": consolidated_files,
        "by_theme": {key: {"documents": sorted(set(value["documents"])), "chunks": sorted(set(value["chunks"]))} for key, value in sorted(by_theme.items())},
        "by_language": {key: {"documents": sorted(set(value["documents"])), "chunks": sorted(set(value["chunks"]))} for key, value in sorted(by_language.items())},
        "by_document_type": {key: {"documents": sorted(set(value["documents"])), "chunks": sorted(set(value["chunks"]))} for key, value in sorted(by_doc_type.items())},
        "parallel_versions": [
            {
                "doc_id": doc_id,
                "parallel_version_of": meta["parallel_version_of"],
                "confidence": meta.get("parallel_version_confidence", "unknown"),
            }
            for doc_id, meta in sorted(all_normalized.items())
            if meta.get("parallel_version_of")
        ],
        "duplicate_groups": [
            {
                "doc_id": doc_id,
                "duplicate_group": meta["duplicate_group"],
                "duplicate_of": meta.get("duplicate_of"),
            }
            for doc_id, meta in sorted(all_normalized.items())
            if meta.get("duplicate_group")
        ],
        "parallel_or_duplicate_candidates": duplicates,
        "low_quality_documents": [record["doc_id"] for record in records if record["ocr_quality"] == "low"],
        "manual_review_priority_documents": [entry["doc_id"] for entry in manual_review_queue],
    }
    write_json(INDEXES_DIR / "knowledge_index.json", knowledge_index)

    write_markdown(DOCS_DIR / "chatbot_legal_guidelines.md", build_guidelines())
    write_markdown(DOCS_DIR / "README_KB.md", build_readme())
    write_markdown(PROMPTS_DIR / "legal_rag_system_prompt.md", build_prompt_file())

    print(f"Built KB for {len(records)} sources.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
