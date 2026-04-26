import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "build_legal_kb.py"
SPEC = importlib.util.spec_from_file_location("build_legal_kb", MODULE_PATH)
build_legal_kb = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(build_legal_kb)


class BuildLegalKbTests(unittest.TestCase):
    def sample_doc_meta(self):
        return {
            "doc_id": "sample_doc",
            "source_file": "sample.pdf",
            "referenced_source_file": "sample.pdf",
            "language": "fr",
            "document_type": "loi",
            "official_title": "Loi de test",
            "title": "Loi de test",
            "short_title": "Loi test",
            "topics": ["officine", "inspection"],
            "jurisdiction": "Maroc",
            "publication_reference": "B.O n° 1234",
            "publication_date": "1 janvier 2025",
            "date_gregorian": "1 janvier 2025",
            "effective_date": "1 janvier 2025",
            "ocr_quality": "high",
            "manual_review_required": False,
            "source_document_kind": "pdf",
            "version": "B.O n° 1234",
        }

    def test_semantic_chunking_splits_large_article(self):
        pages = [
            {
                "page_number": 1,
                "quality": "high",
                "warnings": [],
                "text": "\n".join([
                    "TITRE PREMIER Dispositions générales",
                    "CHAPITRE I Ouverture",
                    "SECTION I Conditions",
                    "Article 12 : Le pharmacien doit tenir un registre de contrôle.",
                    "1. Le pharmacien doit afficher l'autorisation dans l'officine.",
                    "2. Le pharmacien doit conserver les justificatifs pendant un délai de 30 jours.",
                    "3. Le pharmacien doit notifier l'inspection en cas d'incident grave.",
                    "4. Toute infraction est punie d'une amende administrative.",
                    "5. Les mêmes obligations s'appliquent aux annexes techniques.",
                    "6. Le pharmacien doit tenir un registre de contrôle.",
                    "7. Le pharmacien doit afficher l'autorisation dans l'officine.",
                    "8. Le pharmacien doit conserver les justificatifs pendant un délai de 30 jours.",
                    "9. Le pharmacien doit notifier l'inspection en cas d'incident grave.",
                    "10. Toute infraction est punie d'une amende administrative.",
                    "11. Les mêmes obligations s'appliquent aux annexes techniques.",
                    "12. Le pharmacien doit tenir un registre de contrôle.",
                    "13. Le pharmacien doit afficher l'autorisation dans l'officine.",
                    "14. Le pharmacien doit conserver les justificatifs pendant un délai de 30 jours.",
                    "15. Le pharmacien doit notifier l'inspection en cas d'incident grave.",
                    "16. Toute infraction est punie d'une amende administrative.",
                    "17. Les mêmes obligations s'appliquent aux annexes techniques.",
                    "18. Le pharmacien doit tenir un registre de contrôle.",
                    "19. Le pharmacien doit afficher l'autorisation dans l'officine.",
                    "20. Le pharmacien doit conserver les justificatifs pendant un délai de 30 jours.",
                    "21. Le pharmacien doit notifier l'inspection en cas d'incident grave.",
                    "22. Toute infraction est punie d'une amende administrative.",
                    "23. Les mêmes obligations s'appliquent aux annexes techniques.",
                    "24. Le pharmacien doit tenir un registre de contrôle.",
                    "25. Le pharmacien doit afficher l'autorisation dans l'officine.",
                ]),
                "extraction_method": "native_text",
            }
        ]

        chunks = build_legal_kb.build_chunks(pages, self.sample_doc_meta())
        article_chunks = [chunk for chunk in chunks if chunk["article_number"] == "12"]

        self.assertGreater(len(chunks), 1)
        self.assertGreater(len(article_chunks), 1)
        self.assertTrue(all(chunk["metadata_schema_version"] == 2 for chunk in article_chunks))
        self.assertTrue(all(chunk["chunk_type"] in {"article", "article_part"} for chunk in article_chunks))
        self.assertTrue(any(chunk["chunk_total_in_unit"] > 1 for chunk in article_chunks))

    def test_chunk_metadata_is_enriched(self):
        pages = [
            {
                "page_number": 1,
                "quality": "high",
                "warnings": [],
                "text": "\n".join([
                    "Article 3 : Le pharmacien doit afficher l'autorisation.",
                    "Il doit transmettre le dossier dans un délai de 30 jours.",
                    "Toute infraction est punie d'une amende de 5000 dirhams.",
                    "Cette disposition renvoie à la loi n° 17-04.",
                ]),
                "extraction_method": "native_text",
            }
        ]

        chunks = build_legal_kb.build_chunks(pages, self.sample_doc_meta())
        chunk = chunks[0]

        self.assertEqual(chunk["source_document"], "Loi de test")
        self.assertEqual(chunk["document_id"], "sample_doc")
        self.assertEqual(chunk["publication_date"], "1 janvier 2025")
        self.assertEqual(chunk["effective_date"], "1 janvier 2025")
        self.assertEqual(chunk["version"], "B.O n° 1234")
        self.assertIn("officine", chunk["topics"])
        self.assertTrue(chunk["keywords"])
        self.assertTrue(chunk["entities"])
        self.assertTrue(chunk["obligations"])
        self.assertTrue(chunk["sanctions"])
        self.assertTrue(chunk["deadlines"])
        self.assertTrue(chunk["citations"])
        self.assertIn("art. 3", chunk["citation_label"].lower())

    def test_manual_section_keywords_and_questions_are_preserved(self):
        pages = [
            {
                "page_number": 1,
                "quality": "high",
                "warnings": [],
                "keywords": ["autorisation exercer pharmacie", "dossier CNOP"],
                "user_questions": [
                    "Quelles pieces faut-il fournir au CNOP ?",
                    "Ou deposer le dossier d'autorisation ?",
                ],
                "category": "Procedure administrative",
                "text": "\n".join([
                    "Depot du dossier",
                    "Le pharmacien depose sa demande contre recepisse.",
                    "Le dossier doit etre complete avant instruction.",
                ]),
                "extraction_method": "manual_text",
            }
        ]

        chunks = build_legal_kb.build_chunks(pages, self.sample_doc_meta())
        chunk = chunks[0]

        self.assertIn("autorisation exercer pharmacie", chunk["retrieval_keywords"])
        self.assertEqual(chunk["category"], "Procedure administrative")
        self.assertEqual(
            chunk["user_questions"],
            [
                "Quelles pieces faut-il fournir au CNOP ?",
                "Ou deposer le dossier d'autorisation ?",
            ],
        )


if __name__ == "__main__":
    unittest.main()
