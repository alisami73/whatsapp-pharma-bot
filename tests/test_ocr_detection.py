import unittest

from app.models import StructuredDocument, StructuredPage
from app.ocr_detection import LowOCRDetector


class LowOCRDetectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.detector = LowOCRDetector(threshold=0.55)

    def test_readable_french_document_is_not_flagged(self) -> None:
        pages = [
            StructuredPage(
                page_number=1,
                text=(
                    "Article 1. Le pharmacien doit conserver le registre des stupéfiants, "
                    "vérifier chaque entrée et assurer la traçabilité des sorties. "
                    "Les mentions sont tenues sans blanc ni rature et sont conservées selon les délais légaux."
                ),
                paragraphs=[
                    "Article 1. Le pharmacien doit conserver le registre des stupéfiants, vérifier chaque entrée et assurer la traçabilité des sorties.",
                    "Les mentions sont tenues sans blanc ni rature et sont conservées selon les délais légaux.",
                ],
            ),
            StructuredPage(
                page_number=2,
                text=(
                    "Article 2. Toute anomalie de stock doit être signalée à l'autorité compétente. "
                    "Le pharmacien responsable organise l'inventaire et documente les écarts constatés."
                ),
                paragraphs=[
                    "Article 2. Toute anomalie de stock doit être signalée à l'autorité compétente.",
                    "Le pharmacien responsable organise l'inventaire et documente les écarts constatés.",
                ],
            ),
        ]
        document = StructuredDocument(
            document_id="doc_propre",
            source_file="doc.pdf",
            source_path="/tmp/doc.pdf",
            title="Gestion réglementaire",
            language="fr",
            page_count=2,
            pages=pages,
            extraction_method="native",
        )

        result = self.detector.assess(document)

        self.assertFalse(result.is_low_ocr)
        self.assertLess(result.score, 0.55)
        self.assertIn("recognized_word_ratio", result.metrics)

    def test_noisy_document_is_flagged_as_low_ocr(self) -> None:
        pages = [
            StructuredPage(page_number=1, text="� � □ □ ////", paragraphs=["� � □ □ ////"], warnings=["garbled"]),
            StructuredPage(page_number=2, text="aaaabbbb ####", paragraphs=["aaaabbbb ####"], warnings=["garbled"]),
            StructuredPage(page_number=3, text="", paragraphs=[], warnings=["empty_text"]),
        ]
        document = StructuredDocument(
            document_id="doc_bruite",
            source_file="scan.pdf",
            source_path="/tmp/scan.pdf",
            title="Scan",
            language="unknown",
            page_count=3,
            pages=pages,
            extraction_method="native",
        )

        result = self.detector.assess(document)

        self.assertTrue(result.is_low_ocr)
        self.assertGreaterEqual(result.score, 0.55)
        self.assertTrue(result.reasons)


if __name__ == "__main__":
    unittest.main()
