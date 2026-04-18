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

const SYSTEM_PROMPT = `Tu es un assistant spécialisé dans la FSE (Feuille de Soins Électronique) et la CNSS marocaine, dédié aux pharmaciens.

LANGUE DE RÉPONSE — règle absolue :
- Détecte la langue de la question (arabe, français, espagnol, russe, ou autre).
- Réponds TOUJOURS dans cette même langue, sans exception.
- Si la langue n'est pas identifiable, réponds en français.

TERMES TECHNIQUES — règle absolue :
- Les sigles et concepts suivants restent toujours en français, entre guillemets : "FSE", "CNSS", "QR code", "CNDP", "AMO", "Damancom".
- Exemple en arabe : استخدم "QR code" للحصول على الدواء
- Exemple en espagnol : El médico genera la "FSE" electrónica

CONTENU :
- Réponds de façon concise et claire (3-5 phrases maximum).
- Utilise UNIQUEMENT les informations contenues dans la base de connaissances fournie.
- Si la réponse n'est pas dans la base, dis-le honnêtement et oriente vers cnss.ma ou le 0801 005 005.
- Ne génère jamais d'informations inventées sur les remboursements, délais ou montants.`;

// ─── CACHE FAQ ────────────────────────────────────────────────────────────────

let _faqContextCache = null;

function normalizeScope(scope) {
    return String(scope || '').trim().toLowerCase();
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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

function extractMarkdownSections(context) {
    const lines = String(context || '').split('\n');
    const sections = [];
    let current = null;

    lines.forEach((line) => {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith('===')) {
            return;
        }

        if (trimmed.startsWith('### ')) {
            if (current && current.content.length) {
                sections.push(current);
            }

            current = {
                title: trimmed.replace(/^###\s+/, '').trim(),
                content: [],
            };
            return;
        }

        if (!current) {
            current = {
                title: '',
                content: [],
            };
        }

        current.content.push(trimmed);
    });

    if (current && current.content.length) {
        sections.push(current);
    }

    return sections;
}

function looksLikeGeneralFseQuestion(normalizedQuestion, normalizedScope) {
    if (normalizedScope !== 'fse') {
        return false;
    }

    const mentionsFse = normalizedQuestion.includes('fse') ||
        normalizedQuestion.includes('feuille de soins') ||
        normalizedQuestion.includes('feuille soins');

    const asksExplanation = normalizedQuestion.includes('explique') ||
        normalizedQuestion.includes('c est quoi') ||
        normalizedQuestion.includes('comment') ||
        normalizedQuestion.includes('fonctionne') ||
        normalizedQuestion.includes('fonctionnement');

    return mentionsFse && asksExplanation;
}

function buildGeneralFseSummary(context) {
    const normalizedContext = normalizeText(context);

    if (!normalizedContext) {
        return null;
    }

    return [
        'La FSE vise a remplacer une gestion papier longue et administrative des feuilles de soins.',
        'Concretement, le medecin cree une feuille de soins electronique, un QR code ou code unique est genere, puis le patient se presente a la pharmacie avec ce code.',
        'La pharmacie scanne ce code et les medicaments remontent automatiquement dans le logiciel officinal.',
        'Le pharmacien garde le meme role : verifier l ordonnance, delivrer les medicaments et conseiller le patient, avec moins de papier.',
        'Apres la delivrance, les informations sont transmises automatiquement a la CNSS et la delivrance est tracee numeriquement.',
    ].join(' ');
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

    const normalizedQuestion = normalizeText(question);

    if (looksLikeGeneralFseQuestion(normalizedQuestion, normalizeScope(scope))) {
        return buildGeneralFseSummary(context);
    }

    const rawKeywords = normalizedQuestion.split(/\s+/).filter((w) => w.length > 2);
    const expandedKeywords = new Set(rawKeywords);

    rawKeywords.forEach((keyword) => {
        if (keyword === 'fse') {
            ['feuille', 'soins', 'electronique', 'pharmacie', 'qr', 'code'].forEach((value) => expandedKeywords.add(value));
        }
        if (keyword === 'cnss') {
            ['affiliation', 'cotisation', 'amo', 'remboursement'].forEach((value) => expandedKeywords.add(value));
        }
    });

    const sections = extractMarkdownSections(context);
    let bestSection = null;
    let bestScore = 0;

    sections.forEach((section) => {
        const haystack = normalizeText([section.title, ...section.content].join(' '));
        let score = 0;

        expandedKeywords.forEach((kw) => {
            if (haystack.includes(kw)) {
                score += 2;
            }
        });

        if (section.title && normalizedQuestion.includes(normalizeText(section.title))) {
            score += 4;
        }

        if (score > bestScore) {
            bestScore = score;
            bestSection = section;
        }
    });

    if (bestScore > 0 && bestSection) {
        const preview = bestSection.content
            .filter((line) => !line.startsWith('---'))
            .slice(0, 5)
            .join(' ')
            .trim();

        if (preview) {
            return `${bestSection.title}\n\n${preview}`;
        }
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
function detectLanguage(text) {
    if (/[\u0600-\u06FF]/.test(text)) return { code: 'ar', label: 'arabe (العربية)' };
    if (/[\u0400-\u04FF]/.test(text)) return { code: 'ru', label: 'russe (русский)' };
    if (/[¿¡ñÑ]/.test(text) || /\b(el|la|los|las|qué|cómo|explíc|explica|dígame|dime|cuál)\b/i.test(text)) return { code: 'es', label: 'espagnol' };
    return { code: 'fr', label: 'français' };
}

async function answerQuestion(question, scope) {
    const client = getAzureClient();
    const scopeLabel = buildScopeLabel(scope);

    if (!client) {
        console.warn('[CNSS] Azure OpenAI non configuré, basculement en mode dégradé.');
        return fallbackKeywordSearch(question, scope);
    }

    const faqContext = loadFaqContext(scope);
    const lang = detectLanguage(question);

    const langInstruction = `INSTRUCTION IMPÉRATIVE : Tu dois répondre UNIQUEMENT en ${lang.label}. Pas en français, pas dans une autre langue — en ${lang.label} exclusivement.`;

    const userContent = faqContext
        ? `${langInstruction}\n\nBase de connaissances ${scopeLabel} :\n${faqContext}\n\nQuestion : ${question}`
        : `${langInstruction}\n\nQuestion : ${question}\n\n(Aucune base de connaissances ${scopeLabel} chargée — réponds uniquement si tu connais la réponse avec certitude, sinon oriente vers cnss.ma)`;

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
