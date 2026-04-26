import unittest

from app.chunker import SemanticChunker
from app.models import StructuredDocument, StructuredPage


class SemanticChunkerTests(unittest.TestCase):
    def test_chunker_preserves_sections_and_metadata(self) -> None:
        page = StructuredPage(
            page_number=1,
            text=(
                "Chapitre I - Autorisation\n\n"
                "Article 1. L'autorisation d'exercer est accordée après vérification du diplôme, de l'inscription et de l'absence d'incompatibilité.\n\n"
                "Article 2. Le dossier comprend la demande, les pièces justificatives, l'avis ordinal et tout document exigé par l'administration."
            ),
            paragraphs=[
                "Chapitre I - Autorisation",
                "Article 1. L'autorisation d'exercer est accordée après vérification du diplôme, de l'inscription et de l'absence d'incompatibilité.",
                "Article 2. Le dossier comprend la demande, les pièces justificatives, l'avis ordinal et tout document exigé par l'administration.",
            ],
            headings=["Chapitre I - Autorisation"],
        )
        document = StructuredDocument(
            document_id="autorisation",
            source_file="autorisation.pdf",
            source_path="/tmp/autorisation.pdf",
            title="Autorisation d'exercer",
            language="fr",
            page_count=1,
            pages=[page],
            extraction_method="native",
        )

        chunker = SemanticChunker(target_words=70, overlap_words=10)
        chunks = chunker.chunk_document(document, ocr_score=0.12)

        self.assertGreaterEqual(len(chunks), 2)
        self.assertEqual(chunks[0].doc_id, "autorisation")
        self.assertEqual(chunks[0].page_start, 1)
        self.assertEqual(chunks[0].page_end, 1)
        self.assertTrue(chunks[0].section_title)
        self.assertTrue(chunks[0].keywords)
        self.assertTrue(chunks[0].user_questions)

    def test_long_unit_is_split_without_empty_chunks(self) -> None:
        long_paragraph = " ".join(
            [
                "Le pharmacien responsable doit documenter les entrées, vérifier les sorties,"
                " assurer la traçabilité, conserver les justificatifs et signaler toute anomalie."
            ]
            * 35
        )
        page = StructuredPage(page_number=1, text=long_paragraph, paragraphs=[long_paragraph])
        document = StructuredDocument(
            document_id="stocks",
            source_file="stocks.pdf",
            source_path="/tmp/stocks.pdf",
            title="Gestion de stock",
            language="fr",
            page_count=1,
            pages=[page],
            extraction_method="native",
        )

        chunker = SemanticChunker(target_words=140, overlap_words=20)
        chunks = chunker.chunk_document(document, ocr_score=0.4)

        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(chunk.content.strip() for chunk in chunks))


if __name__ == "__main__":
    unittest.main()
