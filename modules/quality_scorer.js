'use strict';

/**
 * modules/quality_scorer.js
 *
 * Scores a generated legal answer on 6 dimensions (total 100 pts).
 * Uses Azure OpenAI gpt-4o-mini with JSON response mode.
 *
 * Designed for fire-and-forget use — never called on the critical reply path.
 *
 * Dimensions:
 *   relevance       (0-20) — Does the answer address the question?
 *   specificity     (0-20) — Concrete details: article numbers, deadlines, figures?
 *   actionability   (0-20) — Can the pharmacist act on this immediately?
 *   completeness    (0-15) — Are the important aspects covered?
 *   legal_grounding (0-15) — Grounded in the legal context provided?
 *   intent_match    (0-10) — Practical vs. theoretical intent matched?
 *
 * Total 100. Answers scoring < 50 are flagged for human review.
 */

let _client = null;

function getClient() {
  if (_client) return _client;
  if (!process.env.AZURE_OPENAI_API_KEY || !process.env.AZURE_OPENAI_ENDPOINT) return null;
  const { AzureOpenAI } = require('openai');
  _client = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-01',
  });
  return _client;
}

const SYSTEM_PROMPT = `Tu es un évaluateur expert pour un assistant juridique destiné aux pharmaciens marocains.

Évalue la réponse générée sur 6 dimensions (total 100 points).

Règles :
- Évalue UNIQUEMENT à partir de la question, du contexte juridique fourni et de la réponse.
- Ne corrige pas la réponse. Attribue des points selon les critères.
- Réponds UNIQUEMENT avec un objet JSON valide, sans commentaires ni markdown.

Dimensions :
  "relevance"       : 0-20 — La réponse traite-t-elle directement la question posée ?
  "specificity"     : 0-20 — Cite-t-elle des articles de loi, délais, chiffres ou procédures concrètes ?
  "actionability"   : 0-20 — Le pharmacien peut-il agir immédiatement sur cette base ?
  "completeness"    : 0-15 — Les aspects importants de la question sont-ils couverts ?
  "legal_grounding" : 0-15 — La réponse est-elle ancrée dans le contexte juridique fourni ?
  "intent_match"    : 0-10 — L'intention (pratique / théorique / urgente) est-elle bien servie ?

Format de réponse (JSON strict) :
{
  "relevance": <int>,
  "specificity": <int>,
  "actionability": <int>,
  "completeness": <int>,
  "legal_grounding": <int>,
  "intent_match": <int>,
  "total": <sum of all 6>,
  "weakness": "<one sentence on main weakness, empty string if total >= 80>"
}`;

/**
 * Score a generated answer.
 *
 * @param {string} question
 * @param {string} answer
 * @param {Array}  contextChunks — array of retrieval result objects ({ chunk, rerankScore, ... })
 * @returns {Promise<{ score: number, dims: object, flagged: boolean } | null>}
 */
async function scoreAnswer(question, answer, contextChunks = []) {
  const client = getClient();
  if (!client) return null;

  const contextSummary = (contextChunks || [])
    .slice(0, 4)
    .map((r, i) => {
      const chunk = r.chunk || r;
      const excerpt = (chunk.legal_summary || chunk.clean_text || chunk.text || '').slice(0, 250);
      const label = chunk.citation_label || chunk.chunk_id || `chunk_${i + 1}`;
      return `[R${i + 1}] ${label}\n${excerpt}`;
    })
    .join('\n\n');

  const userContent = [
    `QUESTION: ${question}`,
    '',
    'CONTEXTE JURIDIQUE UTILISÉ:',
    contextSummary || '(aucun contexte récupéré)',
    '',
    `RÉPONSE GÉNÉRÉE:\n${answer}`,
  ].join('\n');

  try {
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini';
    const completion = await client.chat.completions.create({
      model: deployment,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      max_completion_tokens: 220,
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content || '{}';
    const dims = JSON.parse(raw);

    const score = Number(dims.total) || (
      (Number(dims.relevance) || 0) +
      (Number(dims.specificity) || 0) +
      (Number(dims.actionability) || 0) +
      (Number(dims.completeness) || 0) +
      (Number(dims.legal_grounding) || 0) +
      (Number(dims.intent_match) || 0)
    );

    const clamped = Math.min(100, Math.max(0, Math.round(score)));

    if (clamped < 75) {
      console.log(`[quality-scorer] score=${clamped}/100 — weakness: ${dims.weakness || '—'}`);
    }

    return {
      score: clamped,
      dims,
      flagged: clamped < 50,
      retried: false,
    };
  } catch (err) {
    console.warn('[quality-scorer] Scoring failed (non-blocking):', err.message);
    return null;
  }
}

module.exports = { scoreAnswer };
