import tempfile
import unittest
from pathlib import Path

from app.config import Settings
from app.models import Chunk, utc_now_iso
from app.vector_store import AZURE_VECTOR_FIELD, AzureAISearchVectorStore, JsonVectorStore


def sample_chunk(chunk_id="doc__chunk_001", content="inspection officine registre"):
    return Chunk(
        chunk_id=chunk_id,
        doc_id="doc",
        source_file="doc.pdf",
        source_path="/tmp/doc.pdf",
        page_start=1,
        page_end=1,
        section_title="Inspection",
        content=content,
        language="fr",
        extraction_method="native",
        ocr_score=0.9,
        created_at=utc_now_iso(),
        keywords=["inspection"],
        user_questions=["Que verifier pendant une inspection ?"],
        metadata={"document_title": "Doc"},
    )


class VectorStoreTests(unittest.TestCase):
    def test_json_vector_store_search_keeps_legacy_provider_working(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            store = JsonVectorStore(Path(tmpdir) / "index.json")
            chunk = sample_chunk()

            ids = store.index_chunks([chunk], [[1.0, 0.0]])
            results = store.search([1.0, 0.0], query_text="inspection officine", top_k=1, hybrid=True)

            self.assertEqual(ids, ["doc:doc__chunk_001"])
            self.assertEqual(results[0]["chunk_id"], "doc__chunk_001")
            self.assertGreater(results[0]["score"], 0)

    def test_azure_ai_search_index_payload_contains_expected_fields(self):
        settings = Settings(
            azure_search_endpoint="https://example.search.windows.net",
            azure_search_api_key="key",
            azure_search_index_name="legal-rag",
        )
        store = AzureAISearchVectorStore(settings)
        payload = store._index_payload(1536)
        fields = {field["name"]: field for field in payload["fields"]}

        for field_name in ["id", "document_id", "chunk_id", "content", "content_vector", "source", "page", "metadata_json"]:
            self.assertIn(field_name, fields)

        self.assertEqual(fields[AZURE_VECTOR_FIELD]["dimensions"], 1536)
        self.assertEqual(fields[AZURE_VECTOR_FIELD]["vectorSearchProfile"], "rag-vector-profile")


if __name__ == "__main__":
    unittest.main()
