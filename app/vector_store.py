from __future__ import annotations

from abc import ABC, abstractmethod
import base64
import json
import logging
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Sequence
from urllib import error, parse, request

from .config import Settings
from .logging_utils import get_logger, log_event
from .models import Chunk, to_serializable, utc_now_iso


AZURE_VECTOR_FIELD = "content_vector"
AZURE_VECTOR_PROFILE = "rag-vector-profile"
AZURE_VECTOR_ALGORITHM = "rag-hnsw"


class VectorStore(ABC):
    @abstractmethod
    def index_chunks(self, chunks: Sequence[Chunk], embeddings: Sequence[Sequence[float]]) -> List[str]:
        raise NotImplementedError

    def search(
        self,
        query_embedding: Sequence[float],
        *,
        query_text: str = "",
        top_k: int = 4,
        hybrid: bool = False,
    ) -> List[Dict[str, Any]]:
        raise NotImplementedError("Ce vector store ne fournit pas de recherche.")


class JsonVectorStore(VectorStore):
    """Simple file-based vector store for local and staging environments."""

    def __init__(self, index_path: Path) -> None:
        self.index_path = index_path

    def index_chunks(self, chunks: Sequence[Chunk], embeddings: Sequence[Sequence[float]]) -> List[str]:
        if len(chunks) != len(embeddings):
            raise ValueError("Le nombre de chunks et d'embeddings doit être identique.")

        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        payload = self._load()
        records = payload.setdefault("records", [])
        doc_ids = {chunk.doc_id for chunk in chunks}
        records[:] = [record for record in records if record.get("doc_id") not in doc_ids]

        indexed_ids: List[str] = []
        for chunk, embedding in zip(chunks, embeddings):
            record_id = f"{chunk.doc_id}:{chunk.chunk_id}"
            indexed_ids.append(record_id)
            records.append(
                {
                    "id": record_id,
                    "doc_id": chunk.doc_id,
                    "chunk_id": chunk.chunk_id,
                    "embedding": list(embedding),
                    "chunk": to_serializable(chunk),
                    "indexed_at": utc_now_iso(),
                }
            )

        payload["schema_version"] = 1
        payload["provider"] = "json"
        payload["updated_at"] = utc_now_iso()
        self.index_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return indexed_ids

    def search(
        self,
        query_embedding: Sequence[float],
        *,
        query_text: str = "",
        top_k: int = 4,
        hybrid: bool = False,
    ) -> List[Dict[str, Any]]:
        payload = self._load()
        records = payload.get("records", [])
        if not isinstance(records, list):
            return []

        query_tokens = _tokenize(query_text) if hybrid and query_text else []
        scored: List[Dict[str, Any]] = []
        for record in records:
            embedding = record.get("embedding")
            chunk = record.get("chunk") or {}
            if not isinstance(embedding, list) or not isinstance(chunk, dict):
                continue
            vector_score = _cosine_similarity(query_embedding, embedding)
            lexical_score = _lexical_overlap_score(query_tokens, chunk) if query_tokens else 0.0
            score = vector_score + lexical_score
            if score <= 0:
                continue
            scored.append(
                {
                    "id": record.get("id"),
                    "document_id": record.get("doc_id"),
                    "chunk_id": record.get("chunk_id"),
                    "content": chunk.get("content", ""),
                    "source": chunk.get("source_file", ""),
                    "page": chunk.get("page_start"),
                    "metadata": chunk.get("metadata", {}),
                    "score": score,
                    "vector_score": vector_score,
                    "lexical_score": lexical_score,
                }
            )

        return sorted(scored, key=lambda item: item["score"], reverse=True)[: max(1, top_k)]

    def _load(self) -> Dict[str, object]:
        if not self.index_path.exists():
            return {"schema_version": 1, "provider": "json", "records": []}
        return json.loads(self.index_path.read_text(encoding="utf-8"))


class AzureAISearchVectorStore(VectorStore):
    """Azure AI Search vector store using REST data-plane APIs."""

    def __init__(self, settings: Settings) -> None:
        missing = [
            name
            for name, value in {
                "AZURE_SEARCH_ENDPOINT": settings.azure_search_endpoint,
                "AZURE_SEARCH_API_KEY": settings.azure_search_api_key,
                "AZURE_SEARCH_INDEX_NAME": settings.azure_search_index_name,
            }.items()
            if not value
        ]
        if missing:
            raise RuntimeError(f"Configuration Azure AI Search incomplète: {', '.join(missing)}.")

        self.settings = settings
        self.endpoint = settings.azure_search_endpoint.rstrip("/")
        self.api_key = settings.azure_search_api_key
        self.index_name = settings.azure_search_index_name
        self.api_version = settings.azure_search_api_version
        self.batch_size = max(1, min(settings.azure_search_batch_size, 1000))
        self.logger = get_logger("azure_ai_search", settings.log_level)

    def index_chunks(self, chunks: Sequence[Chunk], embeddings: Sequence[Sequence[float]]) -> List[str]:
        if len(chunks) != len(embeddings):
            raise ValueError("Le nombre de chunks et d'embeddings doit être identique.")
        if not chunks:
            return []
        first_embedding = embeddings[0]
        if not first_embedding:
            raise ValueError("Impossible de créer l'index Azure AI Search avec un embedding vide.")

        self.ensure_index(dimensions=len(first_embedding))
        documents = [self._document_from_chunk(chunk, embedding) for chunk, embedding in zip(chunks, embeddings)]
        indexed_ids: List[str] = []

        for batch in _batched(documents, self.batch_size):
            payload = {"value": [{"@search.action": "mergeOrUpload", **document} for document in batch]}
            response = self._request_json("POST", self._docs_index_path(), payload)
            failures = [
                item
                for item in response.get("value", [])
                if isinstance(item, dict) and item.get("status") is False
            ]
            if failures:
                first = failures[0]
                raise RuntimeError(
                    "Azure AI Search a refusé un ou plusieurs documents: "
                    f"{first.get('key') or first.get('id')}: {first.get('errorMessage')}"
                )
            indexed_ids.extend(str(document["id"]) for document in batch)
            log_event(
                self.logger,
                logging.INFO,
                "azure_ai_search_batch_indexed",
                index_name=self.index_name,
                batch_size=len(batch),
            )

        return indexed_ids

    def search(
        self,
        query_embedding: Sequence[float],
        *,
        query_text: str = "",
        top_k: int = 4,
        hybrid: bool = False,
    ) -> List[Dict[str, Any]]:
        if not query_embedding:
            raise ValueError("La recherche vectorielle nécessite un embedding de requête.")

        top = max(1, top_k)
        payload: Dict[str, Any] = {
            "top": top,
            "select": "id,document_id,chunk_id,content,source,page,metadata_json",
            "vectorQueries": [
                {
                    "kind": "vector",
                    "vector": [float(value) for value in query_embedding],
                    "fields": AZURE_VECTOR_FIELD,
                    "k": top,
                }
            ],
        }

        if hybrid and query_text.strip():
            payload["search"] = query_text.strip()
            payload["searchFields"] = "content,source,metadata_json"

        if self.settings.azure_search_enable_semantic_reranker and query_text.strip():
            if not self.settings.azure_search_semantic_configuration:
                raise RuntimeError(
                    "AZURE_SEARCH_ENABLE_SEMANTIC_RERANKER=true nécessite "
                    "AZURE_SEARCH_SEMANTIC_CONFIGURATION."
                )
            payload["queryType"] = "semantic"
            payload["semanticConfiguration"] = self.settings.azure_search_semantic_configuration
            payload["captions"] = "extractive"

        response = self._request_json("POST", self._docs_search_path(), payload)
        results = []
        for item in response.get("value", []):
            if isinstance(item, dict):
                results.append(self._result_from_document(item))

        log_event(
            self.logger,
            logging.INFO,
            "azure_ai_search_query_succeeded",
            index_name=self.index_name,
            top_k=top,
            hybrid=hybrid and bool(query_text.strip()),
            result_count=len(results),
        )
        return results

    def ensure_index(self, dimensions: int) -> None:
        try:
            existing = self._request_json("GET", self._index_path())
        except AzureAISearchHttpError as exc:
            if exc.status_code != 404:
                raise
            existing = None

        if existing:
            self._validate_index(existing, dimensions)
            return

        self._request_json("PUT", self._index_path(), self._index_payload(dimensions))
        log_event(
            self.logger,
            logging.INFO,
            "azure_ai_search_index_created",
            index_name=self.index_name,
            dimensions=dimensions,
        )

    def _validate_index(self, index: Dict[str, Any], dimensions: int) -> None:
        fields = {field.get("name"): field for field in index.get("fields", []) if isinstance(field, dict)}
        vector_field = fields.get(AZURE_VECTOR_FIELD)
        if not vector_field:
            raise RuntimeError(f"L'index Azure AI Search '{self.index_name}' existe sans champ {AZURE_VECTOR_FIELD}.")
        existing_dimensions = int(vector_field.get("dimensions") or 0)
        if existing_dimensions and existing_dimensions != dimensions:
            raise RuntimeError(
                f"Dimension embedding incompatible pour l'index '{self.index_name}': "
                f"{existing_dimensions} existant, {dimensions} demandé."
            )

    def _index_payload(self, dimensions: int) -> Dict[str, Any]:
        return {
            "name": self.index_name,
            "fields": [
                {"name": "id", "type": "Edm.String", "key": True, "filterable": True, "retrievable": True},
                {
                    "name": "document_id",
                    "type": "Edm.String",
                    "searchable": True,
                    "filterable": True,
                    "retrievable": True,
                },
                {"name": "chunk_id", "type": "Edm.String", "filterable": True, "retrievable": True},
                {"name": "content", "type": "Edm.String", "searchable": True, "retrievable": True},
                {
                    "name": AZURE_VECTOR_FIELD,
                    "type": "Collection(Edm.Single)",
                    "searchable": True,
                    "retrievable": False,
                    "stored": False,
                    "dimensions": dimensions,
                    "vectorSearchProfile": AZURE_VECTOR_PROFILE,
                },
                {
                    "name": "source",
                    "type": "Edm.String",
                    "searchable": True,
                    "filterable": True,
                    "retrievable": True,
                },
                {
                    "name": "page",
                    "type": "Edm.Int32",
                    "filterable": True,
                    "sortable": True,
                    "retrievable": True,
                },
                {"name": "metadata_json", "type": "Edm.String", "searchable": True, "retrievable": True},
            ],
            "vectorSearch": {
                "algorithms": [
                    {
                        "name": AZURE_VECTOR_ALGORITHM,
                        "kind": "hnsw",
                        "hnswParameters": {
                            "m": 4,
                            "efConstruction": 400,
                            "efSearch": 500,
                            "metric": "cosine",
                        },
                    }
                ],
                "profiles": [{"name": AZURE_VECTOR_PROFILE, "algorithm": AZURE_VECTOR_ALGORITHM}],
            },
        }

    def _document_from_chunk(self, chunk: Chunk, embedding: Sequence[float]) -> Dict[str, Any]:
        metadata = {
            **to_serializable(chunk.metadata),
            "section_title": chunk.section_title,
            "source_path": chunk.source_path,
            "page_end": chunk.page_end,
            "language": chunk.language,
            "extraction_method": chunk.extraction_method,
            "ocr_score": chunk.ocr_score,
            "keywords": chunk.keywords,
            "user_questions": chunk.user_questions,
            "created_at": chunk.created_at,
        }
        return {
            "id": make_search_document_id(chunk.doc_id, chunk.chunk_id),
            "document_id": chunk.doc_id,
            "chunk_id": chunk.chunk_id,
            "content": chunk.content,
            "content_vector": [float(value) for value in embedding],
            "source": chunk.source_file,
            "page": int(chunk.page_start or 0),
            "metadata_json": json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
        }

    def _result_from_document(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": item.get("id"),
            "document_id": item.get("document_id"),
            "chunk_id": item.get("chunk_id"),
            "content": item.get("content", ""),
            "source": item.get("source", ""),
            "page": item.get("page"),
            "metadata": _parse_metadata(item.get("metadata_json")),
            "score": item.get("@search.score"),
            "reranker_score": item.get("@search.rerankerScore"),
            "captions": item.get("@search.captions"),
        }

    def _request_json(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.endpoint}{path}"
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}api-version={parse.quote(self.api_version)}"
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = request.Request(
            url,
            data=body,
            method=method,
            headers={"Content-Type": "application/json", "api-key": self.api_key},
        )
        try:
            with request.urlopen(req, timeout=45) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            message = _extract_azure_error(raw) or raw or exc.reason
            log_event(
                self.logger,
                logging.ERROR,
                "azure_ai_search_http_error",
                status_code=exc.code,
                path=path,
                error=message,
            )
            raise AzureAISearchHttpError(exc.code, message) from exc
        except error.URLError as exc:
            log_event(self.logger, logging.ERROR, "azure_ai_search_network_error", path=path, error=str(exc.reason))
            raise RuntimeError(f"Erreur réseau Azure AI Search: {exc.reason}") from exc

    def _index_path(self) -> str:
        return f"/indexes/{parse.quote(self.index_name)}"

    def _docs_index_path(self) -> str:
        return f"/indexes/{parse.quote(self.index_name)}/docs/index"

    def _docs_search_path(self) -> str:
        return f"/indexes/{parse.quote(self.index_name)}/docs/search"


class AzureAISearchHttpError(RuntimeError):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


class UnsupportedVectorStore(VectorStore):
    def __init__(self, provider_name: str) -> None:
        self.provider_name = provider_name

    def index_chunks(self, chunks: Sequence[Chunk], embeddings: Sequence[Sequence[float]]) -> List[str]:
        raise NotImplementedError(
            f"Le provider vectoriel '{self.provider_name}' doit être implémenté dans app/vector_store.py."
        )


def create_vector_store(settings: Settings) -> VectorStore:
    provider = settings.vector_store_provider
    if provider in {"json", "mock", "local_json"}:
        return JsonVectorStore(settings.vector_store_path)
    if provider == "azure_ai_search":
        return AzureAISearchVectorStore(settings)
    if provider in {"elasticsearch", "qdrant", "pinecone", "weaviate", "custom"}:
        return UnsupportedVectorStore(provider)
    raise ValueError(f"Vector store provider non supporté: {provider}")


def make_search_document_id(document_id: str, chunk_id: str) -> str:
    raw = f"{document_id}:{chunk_id}".encode("utf-8")
    encoded = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    return f"chunk-{encoded}"


def _batched(items: Sequence[Dict[str, Any]], size: int) -> List[Sequence[Dict[str, Any]]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _extract_azure_error(raw: str) -> str:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return ""
    error_payload = payload.get("error")
    if isinstance(error_payload, dict):
        return str(error_payload.get("message") or error_payload.get("code") or "")
    return ""


def _parse_metadata(value: object) -> Dict[str, Any]:
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = 0.0
    norm_left = 0.0
    norm_right = 0.0
    for left_value, right_value in zip(left, right):
        left_float = float(left_value or 0.0)
        right_float = float(right_value or 0.0)
        dot += left_float * right_float
        norm_left += left_float * left_float
        norm_right += right_float * right_float
    if not norm_left or not norm_right:
        return 0.0
    return dot / ((norm_left**0.5) * (norm_right**0.5))


def _tokenize(value: str) -> List[str]:
    return re.findall(r"[\wÀ-ÿ\u0600-\u06FF]{2,}", value.lower())


def _lexical_overlap_score(query_tokens: Sequence[str], chunk: Dict[str, Any]) -> float:
    if not query_tokens:
        return 0.0
    haystack = " ".join(
        str(part or "")
        for part in [
            chunk.get("section_title"),
            chunk.get("content"),
            chunk.get("source_file"),
            chunk.get("metadata"),
        ]
    ).lower()
    if not haystack:
        return 0.0
    unique_tokens = set(query_tokens)
    matches = sum(1 for token in unique_tokens if token in haystack)
    return matches / max(1, len(unique_tokens))
