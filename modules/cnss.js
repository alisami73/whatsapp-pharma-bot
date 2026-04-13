/**
 * modules/cnss.js
 *
 * Module FAQ CNSS — répond aux questions des pharmaciens sur la CNSS
 * en utilisant Azure OpenAI avec les documents de la base de connaissances.
 *
 * Configuration requise dans .env :
 *   AZURE_OPENAI_API_KEY        — clé API Azure OpenAI
 *   AZURE_OPENAI_ENDPOINT       — ex: https://your-resource.openai.azure.com/
 *   AZURE_OPENAI_API_VERSION    — ex: 2024-02-01
 *   AZURE_OPENAI_DEPLOYMENT     — nom du déploiement (ex: gpt-4o, gpt-35-turbo)
 *
 * Documents FAQ : placer vos fichiers .txt ou .md dans data/knowledge/
 * Ils seront chargés automatiquement au premier appel.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const KNOWLEDGE_DIR = path.join(__dirname, '..', 'data', 'knowledge');
const MAX_RESPONSE_CHARS = 1400; // Limite WhatsApp confortable
const MAX_CONTEXT_CHARS = 12000; // Limite contexte envoyé au LLM

const SYSTEM_PROMPT = `Tu es un assistant spécialisé dans la CNSS (Caisse Nationale de Sécurité Sociale) marocaine, dédié aux pharmaciens.
Réponds TOUJOURS dans la même langue que la question posée : français si la question est en français, arabe si la question est en arabe.
Réponds de façon concise et claire (3-5 phrases maximum).
Tu utilises UNIQUEMENT les informations contenues dans la base de connaissances fournie.
Si la réponse n'est pas dans la base de connaissances, dis-le honnêtement et oriente vers le site officiel cnss.ma ou le 0801 005 005.
Ne génère jamais d'informations inventées sur les remboursements, délais ou montants.`;

// ─── CACHE FAQ ────────────────────────────────────────────────────────────────

let _faqContextCache = null;

function normalizeScope(scope) {
    return String(scope || '').trim().toLowerCase();
}

function selectKnowledgeFiles(scope) {
    if (!fs.existsSync(KNOWLEDGE_DIR)) {
        return [];
    }

    const allFiles = fs.readdirSync(KNOWLEDGE_DIR)
        .filter((f) => f.endsWith('.txt') || f.endsWith('.md'))
        .sort();

    const normalizedScope = normalizeScope(scope);

    if (normalizedScope === 'fse') {
        const scopedFiles = allFiles.filter((f) => /fse/i.test(f));
        return scopedFiles.length ? scopedFiles : allFiles;
    }

    if (normalizedScope === 'cnss') {
        const scopedFiles = allFiles.filter((f) => /cnss/i.test(f));
        return scopedFiles.length ? scopedFiles : allFiles;
    }

    return allFiles;
}

function buildScopeLabel(scope) {
    const normalizedScope = normalizeScope(scope);

    if (normalizedScope === 'fse') {
        return 'FSE';
    }

    if (normalizedScope === 'cnss') {
        return 'CNSS';
    }

    return 'documentation';
}

/**
 * Charge tous les fichiers .txt et .md du dossier data/knowledge/
 * et les concatène en un seul contexte. Résultat mis en cache.
 */
function loadFaqContext(scope) {
    const normalizedScope = normalizeScope(scope);

    if (_faqContextCache !== null) {
        if (_faqContextCache[normalizedScope] !== undefined) {
            return _faqContextCache[normalizedScope];
        }
    } else {
        _faqContextCache = {};
    }

    if (!fs.existsSync(KNOWLEDGE_DIR)) {
        console.warn('[CNSS] Dossier data/knowledge/ introuvable. Module en mode dégradé.');
        _faqContextCache[normalizedScope] = '';
        return _faqContextCache[normalizedScope];
    }

    const files = selectKnowledgeFiles(scope);

    if (files.length === 0) {
        console.warn('[CNSS] Aucun fichier .txt/.md dans data/knowledge/. Module en mode dégradé.');
        _faqContextCache[normalizedScope] = '';
        return _faqContextCache[normalizedScope];
    }

    const parts = files.map((f) => {
        const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf-8').trim();
        return `=== ${f} ===\n${content}`;
    });

    let context = parts.join('\n\n');

    // Tronquer si trop long
    if (context.length > MAX_CONTEXT_CHARS) {
        context = context.slice(0, MAX_CONTEXT_CHARS) + '\n\n[... contenu tronqué ...]';
        console.warn(`[CNSS] Contexte FAQ tronqué à ${MAX_CONTEXT_CHARS} caractères.`);
    }

    _faqContextCache[normalizedScope] = context;
    console.log(`[CNSS] FAQ chargée (${normalizedScope || 'global'}) : ${files.length} fichier(s), ${context.length} caractères.`);
    return _faqContextCache[normalizedScope];
}

/**
 * Invalide le cache (utile si les fichiers FAQ sont mis à jour à chaud).
 */
function reloadFaqContext(scope) {
    _faqContextCache = null;
    return loadFaqContext(scope);
}

// ─── AZURE OPENAI ─────────────────────────────────────────────────────────────

let _azureClient = null;

function getAzureClient() {
    if (_azureClient) return _azureClient;

    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-02-01';

    if (!apiKey || !endpoint) {
        return null;
    }

    const { AzureOpenAI } = require('openai');
    _azureClient = new AzureOpenAI({ apiKey, endpoint, apiVersion });
    return _azureClient;
}

function getDeployment() {
    return process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-35-turbo';
}

// ─── FALLBACK SANS LLM ────────────────────────────────────────────────────────

/**
 * Recherche par mots-clés dans la FAQ quand Azure OpenAI n'est pas configuré.
 * Retourne la section la plus pertinente ou un message d'indisponibilité.
 */
function fallbackKeywordSearch(question, scope) {
    const context = loadFaqContext(scope);
    const scopeLabel = buildScopeLabel(scope);

    if (!context) {
        return (
            `Le service de questions-réponses ${scopeLabel} n'est pas disponible pour le moment.\n\n` +
            'Pour toute information sur la CNSS :\n' +
            '• Site officiel : cnss.ma\n' +
            '• Téléphone : 0801 005 005'
        );
    }

    const normalized = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const keywords = normalized.split(/\s+/).filter((w) => w.length > 3);

    const lines = context.split('\n');
    let bestLine = null;
    let bestScore = 0;

    lines.forEach((line) => {
        const normalizedLine = line.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        let score = 0;
        keywords.forEach((kw) => {
            if (normalizedLine.includes(kw)) score++;
        });
        if (score > bestScore) {
            bestScore = score;
            bestLine = line;
        }
    });

    if (bestScore > 0 && bestLine) {
        return (
            `Voici ce que j'ai trouvé dans notre base ${scopeLabel} :\n\n${bestLine}\n\n` +
            'Pour plus de détails : cnss.ma ou 0801 005 005'
        );
    }

    return (
        `Je n'ai pas trouvé de réponse précise à votre question dans notre base ${scopeLabel}.\n\n` +
        'Pour toute information :\n' +
        '• Site officiel : cnss.ma\n' +
        '• Téléphone : 0801 005 005'
    );
}

// ─── RÉPONSE PRINCIPALE ───────────────────────────────────────────────────────

/**
 * Répond à une question en utilisant Azure OpenAI + contexte FAQ.
 * Bascule en mode dégradé (keyword search) si Azure OpenAI non configuré.
 *
 * @param {string} question — La question du pharmacien
 * @returns {Promise<string>} — La réponse à envoyer via WhatsApp
 */
async function answerQuestion(question, scope) {
    const client = getAzureClient();
    const scopeLabel = buildScopeLabel(scope);

    if (!client) {
        console.warn('[CNSS] Azure OpenAI non configuré, basculement en mode dégradé.');
        return fallbackKeywordSearch(question, scope);
    }

    const faqContext = loadFaqContext(scope);

    const userContent = faqContext
        ? `Base de connaissances ${scopeLabel} :\n${faqContext}\n\nQuestion du pharmacien : ${question}`
        : `Question du pharmacien : ${question}\n\n(Aucune base de connaissances ${scopeLabel} chargée — réponds uniquement si tu connais la réponse avec certitude, sinon oriente vers cnss.ma)`;

    try {
        console.log(`[CNSS] Appel Azure OpenAI pour : "${question.slice(0, 80)}..."`);

        const completion = await client.chat.completions.create({
            model: getDeployment(),
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userContent },
            ],
            max_tokens: 400,
            temperature: 0.3,
        });

        let reply = completion.choices[0]?.message?.content?.trim() || '';

        if (!reply) {
            return 'Je n\'ai pas pu générer une réponse. Veuillez réessayer ou consulter cnss.ma';
        }

        // Tronquer si trop long pour WhatsApp
        if (reply.length > MAX_RESPONSE_CHARS) {
            reply = reply.slice(0, MAX_RESPONSE_CHARS - 30) + '\n\n[Suite : cnss.ma]';
        }

        console.log(`[CNSS] Réponse générée (${reply.length} chars)`);
        return reply;

    } catch (error) {
        console.error('[CNSS] Erreur Azure OpenAI:', error.message || error);

        // Basculer en fallback si erreur LLM
        const fallback = fallbackKeywordSearch(question, scope);
        return fallback;
    }
}

// ─── PROMPT D'INVITATION ──────────────────────────────────────────────────────

function buildCnssQuestionPrompt(theme) {
    const isFseTheme = theme && theme.id === 'fse';

    return [
        `${theme.title} — Posez votre question`,
        '',
        isFseTheme
            ? 'Posez votre question sur la FSE : fonctionnement, phase pilote, deploiement, impact en pharmacie...'
            : 'Posez votre question sur la CNSS : remboursements, affiliations, cotisations, prestations...',
        '',
        'Envoyez RETOUR pour revenir au menu.',
    ].join('\n');
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
    answerQuestion,
    buildCnssQuestionPrompt,
    loadFaqContext,
    reloadFaqContext,
};
