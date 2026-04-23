-- ============================================================================
-- Supabase schema — whatsapp-pharma-bot RAG
-- Run this once in Supabase SQL editor: https://supabase.com/dashboard
-- ============================================================================

-- 1. Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Legal chunks ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS legal_chunks (
  id             BIGSERIAL    PRIMARY KEY,
  chunk_id       TEXT         UNIQUE NOT NULL,
  doc_id         TEXT         NOT NULL DEFAULT '',
  document_type  TEXT,
  title          TEXT,
  citation_label TEXT,
  chunk_text     TEXT,
  embedding_text TEXT,
  embedding      VECTOR(1536),
  metadata       JSONB        NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Add missing columns if table already existed with a different schema
ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS doc_id         TEXT NOT NULL DEFAULT '';
ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS document_type  TEXT;
ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS title          TEXT;
ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS citation_label TEXT;
ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS chunk_text     TEXT;
ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS embedding_text TEXT;
ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS embedding      VECTOR(1536);
ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS metadata       JSONB NOT NULL DEFAULT '{}';
ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Lookup indexes
CREATE INDEX IF NOT EXISTS legal_chunks_doc_id_idx
  ON legal_chunks (doc_id);

CREATE INDEX IF NOT EXISTS legal_chunks_document_type_idx
  ON legal_chunks (document_type);

CREATE INDEX IF NOT EXISTS legal_chunks_metadata_gin
  ON legal_chunks USING gin (metadata);

-- Full-text search index (simple config = multilingual-safe: FR + AR)
CREATE INDEX IF NOT EXISTS legal_chunks_fts_idx
  ON legal_chunks
  USING gin (to_tsvector('simple',
    COALESCE(chunk_text, '') || ' ' || COALESCE(title, '') || ' ' || COALESCE(citation_label, '')
  ));

-- Vector index — IVFFlat with lists = 32 (good for 1k–50k rows)
-- NOTE: must be created AFTER at least 1 row is inserted, or run separately.
-- If it fails here, run it after embed_and_upload.js has loaded data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'legal_chunks' AND indexname = 'legal_chunks_embedding_ivfflat'
  ) THEN
    CREATE INDEX legal_chunks_embedding_ivfflat
      ON legal_chunks USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 32);
  END IF;
END
$$;

-- ── Hybrid search function ────────────────────────────────────────────────────
-- Returns top-K chunks using RRF fusion of:
--   • pgvector cosine distance (semantic)
--   • PostgreSQL full-text search (lexical, 'simple' config)

CREATE OR REPLACE FUNCTION hybrid_search(
  query_text      TEXT,
  query_embedding VECTOR(1536),
  match_count     INT  DEFAULT 4,
  rrf_k           INT  DEFAULT 60
)
RETURNS TABLE (
  chunk_id       TEXT,
  doc_id         TEXT,
  document_type  TEXT,
  title          TEXT,
  citation_label TEXT,
  chunk_text     TEXT,
  metadata       JSONB,
  rrf_score      DOUBLE PRECISION,
  vector_rank    INT,
  fts_rank       INT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH
  vector_ranked AS (
    SELECT
      lc.chunk_id,
      ROW_NUMBER() OVER (ORDER BY lc.embedding <=> query_embedding) AS rank
    FROM legal_chunks lc
    WHERE lc.embedding IS NOT NULL
    LIMIT match_count * 8
  ),
  fts_ranked AS (
    SELECT
      lc.chunk_id,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(
          to_tsvector('simple',
            COALESCE(lc.chunk_text, '') || ' ' || COALESCE(lc.title, '') || ' ' || COALESCE(lc.citation_label, '')
          ),
          websearch_to_tsquery('simple', query_text)
        ) DESC
      ) AS rank
    FROM legal_chunks lc
    WHERE
      to_tsvector('simple',
        COALESCE(lc.chunk_text, '') || ' ' || COALESCE(lc.title, '') || ' ' || COALESCE(lc.citation_label, '')
      ) @@ websearch_to_tsquery('simple', query_text)
    LIMIT match_count * 8
  ),
  fused AS (
    SELECT
      COALESCE(v.chunk_id, f.chunk_id) AS chunk_id,
      (1.0 / (rrf_k + COALESCE(v.rank, 1000)))
        + (1.0 / (rrf_k + COALESCE(f.rank, 1000))) AS rrf_score,
      v.rank::INT  AS vector_rank,
      f.rank::INT  AS fts_rank
    FROM vector_ranked v
    FULL OUTER JOIN fts_ranked f ON v.chunk_id = f.chunk_id
  )
  SELECT
    lc.chunk_id,
    lc.doc_id,
    lc.document_type,
    lc.title,
    lc.citation_label,
    lc.chunk_text,
    lc.metadata,
    fu.rrf_score,
    fu.vector_rank,
    fu.fts_rank
  FROM fused fu
  JOIN legal_chunks lc ON fu.chunk_id = lc.chunk_id
  ORDER BY fu.rrf_score DESC
  LIMIT match_count;
$$;

-- Grant execute to anon and authenticated roles
GRANT EXECUTE ON FUNCTION hybrid_search TO anon, authenticated;

-- ── Quality logs ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rag_quality_logs (
  id            BIGSERIAL    PRIMARY KEY,
  phone         TEXT,
  question      TEXT         NOT NULL,
  answer        TEXT         NOT NULL,
  context_ids   TEXT[]       NOT NULL DEFAULT '{}',
  quality_score INT,
  quality_dims  JSONB,
  retried       BOOLEAN      NOT NULL DEFAULT FALSE,
  flagged       BOOLEAN      NOT NULL DEFAULT FALSE,
  scope         TEXT,
  lang          TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rag_quality_logs_flagged_idx
  ON rag_quality_logs (flagged) WHERE flagged = TRUE;

CREATE INDEX IF NOT EXISTS rag_quality_logs_score_idx
  ON rag_quality_logs (quality_score);

CREATE INDEX IF NOT EXISTS rag_quality_logs_created_at_idx
  ON rag_quality_logs (created_at DESC);

-- Allow bot (service role) to insert quality logs
-- No RLS needed when using service key.
-- If you switch to anon key, enable RLS and add an INSERT policy.
