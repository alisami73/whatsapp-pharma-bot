# PDF Low-OCR RAG Ingestion

Ce package Python ajoute un pipeline d'ingestion documentaire prêt à brancher sur le chatbot actuel.

## Ce que fait le pipeline

1. Extraction native via le pipeline existant du repo (`scripts/extract_pdf_pages.swift`) ou `pypdf`.
2. Détection automatique low OCR.
3. Si low OCR:
   - upload Azure Blob Storage
   - analyse Azure Document Intelligence
   - nettoyage du texte
   - chunking sémantique
   - embeddings
   - indexation vectorielle
4. Sinon:
   - nettoyage
   - chunking sémantique
   - embeddings
   - indexation vectorielle

## Arborescence

```text
app/
  config.py
  models.py
  logging_utils.py
  pipeline.py
  ocr_detection.py
  native_extractor.py
  azure_blob.py
  azure_doc_intelligence.py
  text_cleaner.py
  chunker.py
  embeddings.py
  vector_store.py
  ingestion_service.py
tests/
  test_ocr_detection.py
  test_chunker.py
requirements.txt
.env.example
README.md
```

## Installation

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configuration

Copier `.env.example` vers `.env`, puis renseigner au minimum:

```env
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=
AZURE_DOCUMENT_INTELLIGENCE_KEY=
AZURE_BLOB_CONNECTION_STRING=
AZURE_BLOB_CONTAINER=rag-documents
OCR_LOW_THRESHOLD=0.55
CHUNK_SIZE=320
CHUNK_OVERLAP=40
TOP_K=4
EMBEDDING_PROVIDER=azure_openai
VECTOR_STORE_PROVIDER=json
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small

# Pour Azure AI Search:
AZURE_SEARCH_ENDPOINT=
AZURE_SEARCH_API_KEY=
AZURE_SEARCH_INDEX_NAME=legal-rag-chunks
```

## Appel Python minimal

```python
from app.ingestion_service import ingest_document

result = ingest_document("/absolute/path/to/document.pdf")
print(result.status, result.method_used, result.number_of_chunks)
```

## Appel CLI minimal

```bash
python3 -m app.ingestion_service /absolute/path/to/document.pdf
```

## Point de branchement depuis le chatbot Node actuel

Le point d'intégration le plus simple est un appel subprocess depuis le code Node existant.

```js
const { spawnSync } = require('node:child_process');

const run = spawnSync(
  'python3',
  ['-m', 'app.ingestion_service', '/absolute/path/to/document.pdf'],
  { cwd: process.cwd(), env: process.env, encoding: 'utf8' }
);

if (run.status !== 0) {
  throw new Error(run.stderr || 'Ingestion Python échouée');
}

const ingestionResult = JSON.parse(run.stdout);
console.log(ingestionResult.status, ingestionResult.method_used);
```

## Sorties et traçabilité

- Journal low OCR: `data/legal_kb/audit/low_ocr_journal.jsonl`
- Index vectoriel local par défaut: `data/legal_kb/indexes/azure_ocr_pipeline_index.json`
- Logs structurés JSON sur stdout

## Schéma du flux

```text
PDF
 -> extraction native
 -> score low OCR
 -> si OK: nettoyage -> chunking -> embeddings -> vector store
 -> si low OCR: Azure Blob -> Azure Document Intelligence -> nettoyage -> chunking -> embeddings -> vector store
```

## Backend vectoriel

Deux backends sont disponibles derrière `VECTOR_STORE_PROVIDER`:

- `json`: backend local historique, utile pour le dev et le rollback.
- `azure_ai_search`: Azure AI Search avec création automatique de l'index, upsert des chunks, recherche vectorielle et recherche hybride.

L'index Azure est créé au premier upsert s'il n'existe pas. Schéma des documents:

```text
id
document_id
chunk_id
content
content_vector
source
page
metadata_json
```

Configuration Azure AI Search:

```env
VECTOR_STORE_PROVIDER=azure_ai_search
TOP_K=4
AZURE_SEARCH_ENDPOINT=https://<service>.search.windows.net
AZURE_SEARCH_API_KEY=<admin-key-for-reindex-or-query-key-for-search-only>
AZURE_SEARCH_INDEX_NAME=legal-rag-chunks
AZURE_SEARCH_API_VERSION=2025-09-01
AZURE_SEARCH_BATCH_SIZE=100
AZURE_SEARCH_ENABLE_HYBRID=true
AZURE_SEARCH_ENABLE_SEMANTIC_RERANKER=false
AZURE_SEARCH_SEMANTIC_CONFIGURATION=
```

Le reranking sémantique est préparé via `AZURE_SEARCH_ENABLE_SEMANTIC_RERANKER`, mais il reste désactivé par défaut. Avant de l'activer, créez ou adaptez une semantic configuration compatible dans l'index Azure AI Search.

## Migration Azure AI Search

Le script de reindex relit les chunks existants, recalcule les embeddings Azure OpenAI, conserve l'index JSON de secours, puis pousse vers Azure AI Search:

```bash
npm run kb:reindex:azure
```

Équivalent explicite:

```bash
VECTOR_STORE_PROVIDER=azure_ai_search node scripts/reindex_legal_kb.js --azure-search
```

Options utiles:

```bash
node scripts/reindex_legal_kb.js --dry-run
node scripts/reindex_legal_kb.js --azure-search --skip-build
node scripts/reindex_legal_kb.js --no-azure-search
```

Smoke test recherche:

```bash
npm run kb:search-smoke -- "Quelles sont les obligations pendant une inspection ?"
npm run kb:search-smoke -- --vector-only "autorisation exercer pharmacie CNOP"
```

Pour rollback immédiat, repassez simplement:

```env
VECTOR_STORE_PROVIDER=json
```

## Déploiement

1. Ajoutez les variables Azure Search et Azure OpenAI dans l'environnement de production.
2. Lancez `npm run kb:reindex:azure` depuis une machine autorisée à joindre Azure Search.
3. Déployez l'application avec `VECTOR_STORE_PROVIDER=azure_ai_search`.
4. Exécutez `npm run kb:search-smoke -- "inspection officine"` après déploiement pour vérifier le retrieval.

## Tests

```bash
python3 -m unittest tests/test_ocr_detection.py tests/test_chunker.py
npm run kb:search-smoke -- "inspection officine"
```

## Notes d'intégration avec ce repo

- L'extraction native réutilise d'abord `scripts/extract_pdf_pages.swift` si `swift` est disponible.
- Le pipeline ne remplace pas le builder juridique existant. Il fournit un nouveau service Python, isolé, prêt à être branché là où vous décidez la route d'ingestion PDF.
- Le backend `json` évite toute dépendance immédiate à une base vectorielle distante pendant la mise en place.
