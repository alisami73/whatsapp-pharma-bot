from __future__ import annotations

from abc import ABC, abstractmethod
import hashlib
import math
from typing import List, Sequence

from .config import Settings
from .models import Chunk


def build_embedding_text(chunk: Chunk) -> str:
    parts = [
        f"Document: {chunk.metadata.get('document_title', chunk.source_file)}",
        f"Section: {chunk.section_title}",
    ]
    if chunk.keywords:
        parts.append("Mots-clés: " + ", ".join(chunk.keywords[:10]))
    if chunk.user_questions:
        parts.append("Questions: " + " | ".join(chunk.user_questions[:3]))
    parts.append(chunk.content)
    return "\n".join(part for part in parts if part.strip())


class EmbeddingProvider(ABC):
    @abstractmethod
    def embed_documents(self, texts: Sequence[str]) -> List[List[float]]:
        raise NotImplementedError


class MockEmbeddingProvider(EmbeddingProvider):
    """Deterministic fallback embedding provider for local and test environments."""

    def __init__(self, dimensions: int = 64) -> None:
        self.dimensions = dimensions

    def embed_documents(self, texts: Sequence[str]) -> List[List[float]]:
        return [self._embed_text(text) for text in texts]

    def _embed_text(self, text: str) -> List[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        values = [((digest[index % len(digest)] / 255.0) * 2.0) - 1.0 for index in range(self.dimensions)]
        norm = math.sqrt(sum(value * value for value in values)) or 1.0
        return [round(value / norm, 6) for value in values]


class AzureOpenAIEmbeddingProvider(EmbeddingProvider):
    def __init__(self, settings: Settings) -> None:
        if not settings.azure_openai_api_key or not settings.azure_openai_endpoint or not settings.azure_openai_embedding_deployment:
            raise RuntimeError("Configuration Azure OpenAI embeddings incomplète.")
        self.settings = settings

    def embed_documents(self, texts: Sequence[str]) -> List[List[float]]:
        try:
            from openai import AzureOpenAI
        except ImportError as exc:  # pragma: no cover - requires openai package
            raise RuntimeError("Le package openai est requis pour Azure OpenAI embeddings.") from exc

        client = AzureOpenAI(
            api_key=self.settings.azure_openai_api_key,
            azure_endpoint=self.settings.azure_openai_endpoint,
            api_version=self.settings.azure_openai_api_version,
        )
        response = client.embeddings.create(
            model=self.settings.azure_openai_embedding_deployment,
            input=list(texts),
        )
        return [list(item.embedding) for item in response.data]


class OpenAIEmbeddingProvider(EmbeddingProvider):
    def __init__(self, settings: Settings) -> None:
        if not settings.openai_api_key or not settings.openai_embedding_model:
            raise RuntimeError("Configuration OpenAI embeddings incomplète.")
        self.settings = settings

    def embed_documents(self, texts: Sequence[str]) -> List[List[float]]:
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover - requires openai package
            raise RuntimeError("Le package openai est requis pour OpenAI embeddings.") from exc

        client = OpenAI(api_key=self.settings.openai_api_key)
        response = client.embeddings.create(model=self.settings.openai_embedding_model, input=list(texts))
        return [list(item.embedding) for item in response.data]


def create_embedding_provider(settings: Settings) -> EmbeddingProvider:
    provider = settings.embedding_provider
    if provider == "azure_openai":
        return AzureOpenAIEmbeddingProvider(settings)
    if provider == "openai":
        return OpenAIEmbeddingProvider(settings)
    if provider in {"mock", "local", "none"}:
        return MockEmbeddingProvider()
    raise ValueError(f"Embedding provider non supporté: {provider}")
