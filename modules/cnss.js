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
const legalKb = require('./legal_kb');
const supabaseKb = require('./supabase_kb');
const qualityScorer = require('./quality_scorer');

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const KNOWLEDGE_DIR = path.join(__dirname, '..', 'data', 'knowledge');
const LEGAL_CHUNKS_DIR = path.join(__dirname, '..', 'data', 'legal_kb', 'chunks');
const LEGAL_PROMPT_PATH = path.join(__dirname, '..', 'data', 'prompts', 'legal_rag_system_prompt.md');
const MAX_RESPONSE_CHARS = 2200; // Laisse de la place a une reponse utile et citee
const MAX_CONTEXT_CHARS = 12000; // Limite contexte envoyé au LLM
const MAX_LEGAL_CONTEXT_CHARS = 14000;
const MAX_LEGAL_CHUNKS = Math.max(1, Number(process.env.TOP_K) || 4);
const DEFAULT_SYSTEM_PROMPT = `Tu es un assistant conversationnel spécialisé dans la réglementation pharmaceutique marocaine, destiné à répondre à des questions libres sur l’exercice de la pharmacie, les officines, l’Ordre des pharmaciens, la déontologie, l’inspection, l’autorisation d’exercice, la pharmacie hospitalière et les textes apparentés.

Ta mission :
- répondre uniquement à partir des informations présentes dans la base de connaissances fournie dans le contexte,
- fournir des réponses claires, prudentes et structurées,
- distinguer les faits explicitement fondés sur les sources des explications simplifiées,
- signaler toute incertitude, contradiction ou insuffisance documentaire.

Règles impératives :
1. N’invente jamais une règle juridique, un article, une sanction ou une procédure.
2. N’affirme jamais qu’un texte dit quelque chose si cela n’apparaît pas dans les extraits fournis.
3. Si les extraits sont insuffisants, dis-le explicitement.
4. Si les documents semblent mal OCRisés, incomplets ou ambigus, indique que la réponse doit être vérifiée.
5. Ne donne pas un avis juridique définitif ; donne une information réglementaire fondée sur la base disponible.
6. Si plusieurs sources existent, privilégie la réponse la plus prudente et mentionne les éventuelles différences.
7. Si la question est hors périmètre de la base, indique-le clairement.
8. Si la question est en arabe, réponds en arabe. Si elle est en français, réponds en français. Si la question mélange les deux, réponds dans la langue dominante de l’utilisateur.
9. Ne mentionne pas de connaissances extérieures non fournies dans le contexte.
10. Quand une réponse repose sur une source, cite le titre du texte, l’article ou la page si disponible.

Format de réponse attendu :
- Réponse utile
- Fondement
- Limites / points à vérifier
- Sources

Style :
- professionnel
- simple
- précis
- sans jargon inutile
- sans ton alarmiste`;

const STRUCTURED_LABELS = {
    fr: {
        short: 'Réponse utile',
        shortPractical: 'Ce que vous devez faire',
        foundation: 'Fondement',
        foundationLegal: 'Base juridique',
        limits: 'Limites / points à vérifier',
        limitsPractical: 'Risques / points à vérifier',
        sources: 'Sources',
        sourcesPractical: 'Sources utiles',
        noSource: "Aucun fondement exploitable n'a été retrouvé dans la base actuelle pour cette question.",
        verify: 'Une vérification humaine est recommandée.',
        faqNotice: "Le contexte disponible est de nature opérationnelle / documentaire interne et non nécessairement un texte réglementaire officiel.",
        insufficient: "Les extraits disponibles ne permettent pas d'apporter une réponse suffisamment fondée.",
    },
    ar: {
        short: 'الجواب العملي',
        shortPractical: 'ما الذي يجب عليك فعله',
        foundation: 'الأساس',
        foundationLegal: 'الأساس القانوني',
        limits: 'الحدود / ما يجب التحقق منه',
        limitsPractical: 'المخاطر / ما يجب التحقق منه',
        sources: 'المصادر',
        sourcesPractical: 'المصادر المفيدة',
        noSource: 'لم يتم العثور على أساس قابل للاستغلال في القاعدة الحالية لهذا السؤال.',
        verify: 'يوصى بالتحقق البشري.',
        faqNotice: 'السياق المتاح ذو طبيعة تشغيلية / توثيقية داخلية وليس بالضرورة نصا تنظيميا رسميا.',
        insufficient: 'المقتطفات المتاحة لا تسمح بتقديم جواب مؤسس بشكل كاف.',
    },
    es: {
        short: 'Respuesta útil',
        shortPractical: 'Lo que debe hacer',
        foundation: 'Fundamento',
        foundationLegal: 'Base jurídica',
        limits: 'Límites / puntos a verificar',
        limitsPractical: 'Riesgos / puntos a verificar',
        sources: 'Fuentes',
        sourcesPractical: 'Fuentes útiles',
        noSource: 'No se encontró fundamento utilizable en la base actual para esta pregunta.',
        verify: 'Se recomienda verificación humana.',
        faqNotice: 'El contexto disponible es operativo / documental interno y no necesariamente un texto reglamentario oficial.',
        insufficient: 'Los extractos disponibles no permiten dar una respuesta suficientemente fundamentada.',
    },
    ru: {
        short: 'Полезный ответ',
        shortPractical: 'Что вам нужно сделать',
        foundation: 'Основание',
        foundationLegal: 'Правовая основа',
        limits: 'Ограничения / что нужно проверить',
        limitsPractical: 'Риски / что нужно проверить',
        sources: 'Источники',
        sourcesPractical: 'Полезные источники',
        noSource: 'В текущей базе не найдено пригодного основания для этого вопроса.',
        verify: 'Рекомендуется человеческая проверка.',
        faqNotice: 'Доступный контекст носит операционный / внутренний документальный характер и не обязательно является официальным нормативным текстом.',
        insufficient: 'Доступных фрагментов недостаточно для достаточно обоснованного ответа.',
    },
};

// ─── CACHE FAQ ────────────────────────────────────────────────────────────────

let _faqContextCache = null;
let _legalChunksCache = null;
let _systemPromptCache = null;

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

    if (normalizedScope === 'cndp') {
        const scopedFiles = allFiles.filter((f) => /cndp/i.test(f));
        return scopedFiles.length ? scopedFiles : allFiles;
    }

    // Thème fusionné conformites = tout le corpus (CNDP + CNSS + règlements)
    if (normalizedScope === 'conformites') {
        return allFiles;
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

    if (normalizedScope === 'cndp') {
        return 'CNDP (Loi 09-08)';
    }

    if (normalizedScope === 'conformites' || normalizedScope === 'compliance' || normalizedScope === 'regulations') {
        return 'Textes et Conformités en pharmacie';
    }

    return 'documentation';
}

function extractMarkdownSections(context) {
    const lines = String(context || '').split('\n');
    const sections = [];
    let current = null;
    let currentSource = null;

    lines.forEach((line) => {
        const trimmed = line.trim();

        if (!trimmed) {
            return;
        }

        if (trimmed.startsWith('===')) {
            currentSource = trimmed
                .replace(/^===\s*/, '')
                .replace(/\s*===\s*$/, '')
                .replace(/^Source:\s*/i, '')
                .trim() || null;
            return;
        }

        if (trimmed.startsWith('### ')) {
            if (current && current.content.length) {
                sections.push(current);
            }

            current = {
                title: trimmed.replace(/^###\s+/, '').trim(),
                content: [],
                sourceFile: currentSource,
            };
            return;
        }

        if (!current) {
            current = {
                title: '',
                content: [],
                sourceFile: currentSource,
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
        return `=== Source: ${f} ===\n${content}`;
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

function loadSystemPrompt() {
    if (_systemPromptCache !== null) {
        return _systemPromptCache;
    }

    try {
        if (fs.existsSync(LEGAL_PROMPT_PATH)) {
            const content = fs.readFileSync(LEGAL_PROMPT_PATH, 'utf-8').trim();
            if (content) {
                _systemPromptCache = content;
                return _systemPromptCache;
            }
        }
    } catch (error) {
        console.warn('[CNSS] Impossible de charger le prompt juridique personnalisé:', error.message);
    }

    _systemPromptCache = DEFAULT_SYSTEM_PROMPT;
    return _systemPromptCache;
}

function buildSystemPrompt(scope) {
    const scopeLabel = buildScopeLabel(scope);
    return `${loadSystemPrompt()}

Contexte d'exécution :
- Thème actif du chatbot : ${scopeLabel}.
- Réponds uniquement à partir du contexte fourni dans ce tour.
- Si le contexte provient d'une FAQ ou d'un guide opérationnel interne, ne le présente pas comme un texte réglementaire officiel.
- Si une source contient un avertissement de qualité, mentionne-le dans "Limites / points à vérifier".
- Si aucun fondement n'est trouvé dans le contexte, dis-le explicitement.
- Le premier bloc doit répondre directement à la question de manière utile ; il ne doit pas être artificiellement court.
- N'affiche jamais de marqueurs internes du type [R1], [R2], [R3] dans la réponse finale.
- Respecte strictement le format demandé avec les quatre rubriques.`;
}

function getStructuredLabels(langCode, options = {}) {
    const base = STRUCTURED_LABELS[langCode] || STRUCTURED_LABELS.fr;
    const { practical = false, legal = false } = options;

    return {
        ...base,
        short: practical ? (base.shortPractical || base.short) : base.short,
        foundation: legal ? (base.foundationLegal || base.foundation) : base.foundation,
        limits: practical ? (base.limitsPractical || base.limits) : base.limits,
        sources: legal ? (base.sourcesPractical || base.sources) : base.sources,
    };
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractAssistantText(message) {
    const content = message?.content;

    if (typeof content === 'string') {
        return content.trim();
    }

    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') {
                    return part;
                }
                if (typeof part?.text === 'string') {
                    return part.text;
                }
                if (typeof part?.content === 'string') {
                    return part.content;
                }
                if (typeof part?.text?.value === 'string') {
                    return part.text.value;
                }
                return '';
            })
            .join('\n')
            .trim();
    }

    return '';
}

function uniqueNonEmpty(items) {
    const seen = new Set();
    return items
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .filter((item) => {
            if (seen.has(item)) {
                return false;
            }
            seen.add(item);
            return true;
        });
}

function normalizeStructuredHeadings(text, langCode, labelOptions = {}) {
    const labels = getStructuredLabels(langCode, labelOptions);
    const headingAliases = [
        { aliases: ['Réponse courte', 'Réponse utile', 'Ce que vous devez faire', 'Short answer', 'Useful answer'], target: labels.short },
        { aliases: ['Fondement', 'Base juridique', 'Foundation', 'Basis'], target: labels.foundation },
        { aliases: ['Limites / points à vérifier', 'Risques / points à vérifier', 'Points à vérifier', 'Limits / points to verify', 'Limits'], target: labels.limits },
        { aliases: ['Sources', 'Sources utiles', 'Source'], target: labels.sources },
    ];

    let output = String(text || '');
    headingAliases.forEach(({ aliases, target }) => {
        aliases.forEach((alias) => {
            const pattern = new RegExp(`^${escapeRegExp(alias)}(?=\\s*:|\\s*$)`, 'gim');
            output = output.replace(pattern, target);
        });
    });

    return output;
}

function replaceReferencePlaceholders(text, legalResults = []) {
    const referenceMap = new Map();
    legalResults.forEach((entry, index) => {
        const label = legalKb.buildCitationLabel(entry.chunk);
        if (label) {
            referenceMap.set(String(index + 1), label);
        }
    });

    return String(text || '').replace(/\[(?:R|r)\s*(\d+)\]/g, (match, refNumber) => {
        const label = referenceMap.get(String(refNumber));
        return label ? `(${label})` : match;
    });
}

function ensureReadableSourcesSection(text, legalResults = [], langCode = 'fr', labelOptions = {}) {
    if (!legalResults.length) {
        return String(text || '').trim();
    }

    const labels = getStructuredLabels(langCode, labelOptions);
    const output = String(text || '').trim();
    const hasSourcesHeading = new RegExp(`^${escapeRegExp(labels.sources)}(?=\\s*:|\\s*$)`, 'mi').test(output);

    if (hasSourcesHeading) {
        return output;
    }

    const sourceLines = legalResults
        .slice(0, 4)
        .map((entry) => legalKb.buildCitationLabel(entry.chunk))
        .filter(Boolean);

    if (!sourceLines.length) {
        return output;
    }

    return `${output}\n\n${labels.sources}\n- ${sourceLines.join('\n- ')}`.trim();
}

function postProcessLegalReply(text, legalResults = [], langCode = 'fr', labelOptions = {}) {
    let output = String(text || '').trim();
    output = replaceReferencePlaceholders(output, legalResults);
    output = normalizeStructuredHeadings(output, langCode, labelOptions);
    output = ensureReadableSourcesSection(output, legalResults, langCode, labelOptions);
    return output.trim();
}

function buildLegalAnswerStyleInstruction(langCode, legalRetrieval) {
    const queryFeatures = legalRetrieval?.queryFeatures || {};
    const labels = getStructuredLabels(langCode, {
        practical: Boolean(queryFeatures.asksAboutPractical),
        legal: true,
    });
    const lines = [
        'Format obligatoire :',
        `- ${labels.short}`,
        `- ${labels.foundation}`,
        `- ${labels.limits}`,
        `- ${labels.sources}`,
        `- N'utilise jamais les marqueurs internes [R1], [R2], etc. dans la réponse finale.`,
        `- Dans la rubrique "${labels.sources}", écris des références lisibles pour un pharmacien : titre + article/page quand disponible.`,
        `- Dans la rubrique "${labels.short}", réponds directement à la question ; évite les formulations vagues ou passe-partout.`,
    ];

    if (queryFeatures.asksAboutPractical) {
        lines.push(`- La question est pratique et explicite. Dans "${labels.short}", donne une checklist concrète de 5 à 8 points utiles.`);
        lines.push('- Quand les sources le permettent, couvre : documents à sortir, vérifications matérielles et registres sensibles, puis conduite pendant la visite.');
        lines.push('- Évite des phrases vagues comme "préparer plusieurs éléments essentiels" ou "assurer la conformité". Donne les éléments précis présents dans les sources.');
    }

    if (queryFeatures.asksAboutSanctions) {
        lines.push('- Si les extraits mentionnent une sanction, cite-la clairement ; sinon dis explicitement que la sanction précise n’apparaît pas dans les extraits fournis.');
    }

    if (queryFeatures.asksAboutDeadlines) {
        lines.push('- Si les extraits mentionnent un délai, indique-le précisément ; sinon dis qu’aucun délai précis n’apparaît dans les extraits fournis.');
    }

    return lines.join('\n');
}

function buildPracticalShortLines(chunks = []) {
    const candidates = [];

    chunks.forEach((chunk) => {
        const citation = normalizeText(legalKb.buildCitationLabel(chunk));
        let chunkScore = 0;

        if (chunk.document_type === 'guide_pratique') chunkScore += 8;
        if (citation.includes('checklist avant la visite')) chunkScore += 7;
        if (citation.includes('pendant la visite')) chunkScore += 6;
        if (citation.includes('registres')) chunkScore += 5;
        if (citation.includes('locaux') || citation.includes('materiel')) chunkScore += 4;
        if (citation.includes('inspection')) chunkScore += 2;
        if (chunk.confidence === 'high') chunkScore += 1;

        (chunk.key_rules || []).forEach((line, index) => {
            let score = chunkScore - (index * 0.2);
            const normalizedLine = normalizeText(line);

            if (/autorisation|diplome|factures|registres?/.test(normalizedLine)) score += 2;
            if (/ordre de mission|carte professionnelle|rapport|signer/.test(normalizedLine)) score += 2;
            if (/stupefiants|ordonnancier|alcool/.test(normalizedLine)) score += 1.5;
            if (/refrigerateur|thermometre|armoire|preparatoire/.test(normalizedLine)) score += 1.5;

            candidates.push({ line, score });
        });
    });

    return uniqueNonEmpty(
        candidates
            .sort((left, right) => right.score - left.score)
            .map((entry) => entry.line)
    ).slice(0, 7);
}

function getLegalSearchFallbackNotice(langCode) {
    const notices = {
        fr: 'La recherche juridique avancée est temporairement indisponible ; réponse reconstruite à partir de la base locale.',
        ar: 'البحث القانوني المتقدم غير متاح مؤقتا؛ تمت إعادة بناء الجواب انطلاقا من القاعدة المحلية.',
        es: 'La búsqueda jurídica avanzada está temporalmente indisponible; la respuesta se reconstruyó a partir de la base local.',
        ru: 'Расширенный правовой поиск временно недоступен; ответ восстановлен на основе локальной базы.',
    };

    return notices[langCode] || notices.fr;
}

function getLegalSearchUnavailableLine(langCode) {
    const lines = {
        fr: "La recherche juridique distante est temporairement indisponible et aucun extrait local suffisamment pertinent n'a été retrouvé.",
        ar: 'البحث القانوني البعيد غير متاح مؤقتا ولم يتم العثور على مقتطف محلي ذي صلة كافية.',
        es: 'La búsqueda jurídica remota está temporalmente indisponible y no se encontró ningún extracto local suficientemente pertinente.',
        ru: 'Удаленный правовой поиск временно недоступен, и не найдено достаточно релевантных локальных фрагментов.',
    };

    return lines[langCode] || lines.fr;
}

function formatStructuredLegalAnswerFromChunks(chunks, langCode, labelOptions = {}, extraLimitLines = []) {
    const shortAnswer = chunks[0]?.legal_summary || (chunks[0]?.clean_text || chunks[0]?.text || '').slice(0, 400);
    const shortLines = labelOptions.practical ? buildPracticalShortLines(chunks) : null;
    const foundationLines = chunks.slice(0, 3).map((chunk) => {
        const excerpt = (chunk.legal_summary || chunk.clean_text || chunk.text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
        return `${excerpt} (${legalKb.buildCitationLabel(chunk)})`;
    });

    const limitLines = uniqueNonEmpty([
        ...extraLimitLines,
        chunks.some((chunk) => chunk.manual_review_required) ? 'Au moins une source pertinente nécessite une relecture humaine prioritaire.' : null,
        chunks.some((chunk) => chunk.confidence && chunk.confidence !== 'high') ? 'Certaines sources pertinentes ne sont pas au niveau de confiance le plus élevé.' : null,
        chunks.some((chunk) => chunk.document_type === 'autre') ? 'Au moins une source pertinente est un document opérationnel / manuel et non un texte normatif officiel.' : null,
    ]);

    return formatStructuredAnswer(langCode, {
        shortLines,
        shortAnswer,
        foundationLines,
        limitLines: limitLines.length ? limitLines : [getStructuredLabels(langCode, labelOptions).verify],
        sourceLines: chunks.slice(0, 4).map((chunk) => legalKb.buildCitationLabel(chunk)),
        labelOptions,
    });
}

function formatStructuredAnswer(langCode, payload) {
    const labels = getStructuredLabels(langCode, payload.labelOptions || {});
    const sections = [
        { title: labels.short, lines: payload.shortLines?.length ? payload.shortLines : [payload.shortAnswer || labels.noSource] },
        { title: labels.foundation, lines: payload.foundationLines?.length ? payload.foundationLines : [labels.insufficient] },
        { title: labels.limits, lines: payload.limitLines?.length ? payload.limitLines : [labels.verify] },
        { title: labels.sources, lines: payload.sourceLines?.length ? uniqueNonEmpty(payload.sourceLines) : ['-'] },
    ];

    return sections
        .map((section) => {
            const lines = section.lines.map((line) => (line.startsWith('-') ? line : `- ${line}`));
            return `${section.title}\n${lines.join('\n')}`;
        })
        .join('\n\n');
}

const FR_STOP_WORDS = new Set(['les', 'des', 'est', 'que', 'une', 'pas', 'sur', 'par', 'aux', 'qui', 'son', 'ses', 'leur', 'leurs', 'dans', 'mais', 'avec', 'pour', 'tout', 'plus', 'cette', 'etre', 'vous', 'nous', 'ils', 'elles', 'comment', 'quoi', 'quel', 'quels', 'quelle', 'quelles', 'quand', 'vrai', 'faux', 'bien', 'tres']);

function tokenizeSearch(value) {
    const normalized = normalizeText(value);
    const tokens = normalized
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2 && !FR_STOP_WORDS.has(token));

    const expansions = [];
    const raw = String(value || '');

    // Arabic expansions (test against raw input)
    const arabicRules = [
        { pattern: /صيدلية|الصيدلية/u, values: ['pharmacie', 'officine'] },
        { pattern: /صيدلي|الصيدلي/u, values: ['pharmacien'] },
        { pattern: /فتح|افتتاح/u, values: ['ouverture'] },
        { pattern: /شروط/u, values: ['conditions'] },
        { pattern: /مزاولة|ممارسة/u, values: ['exercice'] },
        { pattern: /ترخيص|رخصة|اذن/u, values: ['autorisation'] },
        { pattern: /تفتيش|مراقبة/u, values: ['inspection', 'controle'] },
        { pattern: /غياب/u, values: ['absence'] },
        { pattern: /تعويض|استخلاف/u, values: ['remplacement'] },
        { pattern: /اخلاقيات|آداب|ديونتولوجيا/u, values: ['deontologie'] },
        { pattern: /مستشفى|استشفائي/u, values: ['hospitaliere'] },
        { pattern: /معادلة|تكافؤ/u, values: ['equivalence'] },
        { pattern: /هيئة|النظام|الامر/u, values: ['ordre'] },
        { pattern: /حضور|موجود/u, values: ['presence', 'absence', 'remplacement'] },
        { pattern: /مخدرات|مخدر/u, values: ['stupefiants', 'registre'] },
        { pattern: /اجازة|عطلة/u, values: ['conges', 'travail'] },
        { pattern: /عامل|موظف/u, values: ['employe', 'travail', 'cnss'] },
        { pattern: /اجر|راتب/u, values: ['salaire', 'smig', 'travail'] },
        { pattern: /تسجيل|انخراط/u, values: ['cnss', 'affiliation', 'inscription'] },
    ];

    arabicRules.forEach((rule) => {
        if (rule.pattern.test(raw)) {
            expansions.push(...rule.values);
        }
    });

    // French stem expansions (test against normalized input)
    const frenchRules = [
        { pattern: /absen|s absen/, values: ['absence', 'remplacement', 'officine'] },
        { pattern: /presen/, values: ['presence', 'absence', 'remplacement'] },
        { pattern: /inspect/, values: ['inspection', 'controle', 'dmp'] },
        { pattern: /stupef|narcot|morphin|codein/, values: ['stupefiants', 'registre', 'armoire'] },
        { pattern: /autoris/, values: ['autorisation', 'exercice', 'cnop'] },
        { pattern: /conge|vacance/, values: ['conges', 'droit travail', 'travail'] },
        { pattern: /licenci/, values: ['licenciement', 'droit travail', 'travail'] },
        { pattern: /smig|salaire|remunerat|paye|paie/, values: ['salaire', 'smig', 'travail', 'cnss'] },
        { pattern: /cotis|affili/, values: ['cnss', 'cotisation', 'affiliation'] },
        { pattern: /registr|comptabil/, values: ['registre', 'comptabilite'] },
        { pattern: /carnet/, values: ['stupefiants', 'carnet', 'commande'] },
        { pattern: /armoir/, values: ['armoire', 'stupefiants', 'stockage'] },
        { pattern: /tiers.?payant|rembours|mutuelle/, values: ['tiers payant', 'amo', 'remboursement'] },
        { pattern: /diplom|equivalen/, values: ['diplome', 'equivalence', 'autorisation', 'cnop'] },
        { pattern: /droit.trav|employe|employeur/, values: ['droit travail', 'cnss', 'obligations'] },
        { pattern: /conformit|cndp/, values: ['conformite', 'cndp', 'loi 09-08'] },
        { pattern: /ouvertur/, values: ['ouverture', 'officine', 'autorisation'] },
        { pattern: /ordonnanc/, values: ['ordonnancier', 'ordonnance', 'prescription'] },
        { pattern: /prescri/, values: ['prescription', 'ordonnance', 'medicament'] },
        { pattern: /titulaire/, values: ['pharmacien', 'titulaire', 'officine'] },
        { pattern: /garde|permanence/, values: ['absence', 'pharmacie', 'remplacement'] },
        { pattern: /obligatoi|obligat/, values: ['obligation', 'reglementation', 'loi'] },
    ];

    frenchRules.forEach((rule) => {
        if (rule.pattern.test(normalized)) {
            expansions.push(...rule.values);
        }
    });

    return Array.from(new Set([...tokens, ...expansions]));
}

function loadLegalChunks() {
    if (_legalChunksCache !== null) {
        return _legalChunksCache;
    }

    if (!fs.existsSync(LEGAL_CHUNKS_DIR)) {
        console.warn('[CNSS] Dossier data/legal_kb/chunks/ introuvable.');
        _legalChunksCache = [];
        return _legalChunksCache;
    }

    const files = fs.readdirSync(LEGAL_CHUNKS_DIR)
        .filter((file) => file.endsWith('.json'))
        .sort();

    const chunks = [];

    files.forEach((file) => {
        try {
            const raw = JSON.parse(fs.readFileSync(path.join(LEGAL_CHUNKS_DIR, file), 'utf-8'));
            const chunkList = Array.isArray(raw)
                ? raw
                : Array.isArray(raw?.chunks)
                ? raw.chunks
                : [];

            chunkList.forEach((chunk) => {
                chunks.push({
                    ...chunk,
                    _searchTitle: normalizeText([chunk.official_title, chunk.short_title, chunk.structure_path, chunk.article_number].join(' ')),
                    _searchTags: normalizeText([
                        ...(chunk.topic_tags || []),
                        ...(chunk.retrieval_keywords || []),
                    ].join(' ')),
                    _searchBody: normalizeText([
                        chunk.legal_summary,
                        ...(chunk.key_rules || []),
                        ...(chunk.definitions || []),
                        chunk.clean_text,
                        chunk.text,
                        chunk.citation_label,
                    ].join(' ')),
                });
            });
        } catch (error) {
            console.warn(`[CNSS] Impossible de charger le fichier juridique ${file}: ${error.message}`);
        }
    });

    _legalChunksCache = chunks;
    console.log(`[CNSS] Chunks juridiques chargés : ${chunks.length}`);
    return _legalChunksCache;
}

function scoreLegalChunk(chunk, tokens, normalizedQuestion, langCode) {
    let score = 0;

    tokens.forEach((token) => {
        if (chunk._searchTitle.includes(token)) {
            score += 6;
        }
        if (chunk._searchTags.includes(token)) {
            score += 4;
        }
        if (chunk._searchBody.includes(token)) {
            score += 1;
        }
    });

    const normalizedArticleRef = chunk.article_number
        ? normalizeText(`article ${chunk.article_number}`)
        : '';
    if (normalizedArticleRef && normalizedQuestion.includes(normalizedArticleRef)) {
        score += 6;
    }

    const chunkLang = chunk.language || 'fr';
    if (langCode === 'ar' && (chunkLang === 'ar' || chunkLang === 'mixed')) {
        score += 2;
    }
    if (langCode !== 'ar' && (chunkLang === 'fr' || chunkLang === 'mixed' || chunkLang === 'unknown')) {
        score += 2;
    }

    if (chunk.confidence === 'high') {
        score += 1;
    } else if (chunk.confidence === 'medium') {
        score += 0.5;
    }

    if (chunk.manual_review_required) {
        score -= 1;
    }

    const hasToken = (value) => tokens.includes(value);
    const searchCorpus = [chunk._searchTitle, chunk._searchTags, chunk._searchBody].join(' ');
    const intentBoosts = [
        {
            active: hasToken('ouverture') && (hasToken('officine') || hasToken('pharmacie')),
            patterns: ['ouverture d officine', 'ouverture officine', 'normes techniques', 'installation de salubrite et de surface'],
            boost: 12,
        },
        {
            active: hasToken('inspection') || hasToken('controle'),
            patterns: ['inspection', 'controle', 'pharmaciens inspecteurs'],
            boost: 10,
        },
        {
            active: hasToken('ordre'),
            patterns: ['ordre des pharmaciens', 'conseils regionaux', 'conseil national'],
            boost: 10,
        },
        {
            active: hasToken('deontologie'),
            patterns: ['deontologie', 'code de deontologie'],
            boost: 10,
        },
        {
            active: hasToken('hospitaliere'),
            patterns: ['pharmacie hospitaliere', 'services de pharmacie'],
            boost: 10,
        },
        {
            active: hasToken('autorisation') || hasToken('exercice'),
            patterns: ['autorisation', 'exercice de la pharmacie', 'equivalence'],
            boost: 8,
        },
        {
            active: hasToken('absence') || hasToken('remplacement'),
            patterns: ['absence du pharmacien', 'remplacement'],
            boost: 8,
        },
    ];

    intentBoosts.forEach((rule) => {
        if (rule.active && rule.patterns.some((pattern) => searchCorpus.includes(pattern))) {
            score += rule.boost;
        }
    });

    return score;
}

function detectLegalIntent(tokens) {
    const has = (value) => tokens.includes(value);

    if (has('ouverture') && (has('officine') || has('pharmacie'))) {
        return 'opening_officine';
    }
    if (has('inspection') || has('controle')) {
        return 'inspection';
    }
    if (has('ordre')) {
        return 'ordre';
    }
    if (has('deontologie')) {
        return 'deontologie';
    }
    if (has('hospitaliere')) {
        return 'hospitaliere';
    }
    if (has('autorisation') || has('exercice') || has('equivalence')) {
        return 'exercice';
    }
    if (has('absence') || has('remplacement')) {
        return 'absence';
    }

    return null;
}

function matchesLegalIntent(chunk, intent) {
    const corpus = [chunk._searchTitle, chunk._searchBody].join(' ');
    const byIntent = {
        opening_officine: ['ouverture d officine', 'ouverture officine', 'normes techniques', 'local devant abriter une officine', 'installation de salubrite'],
        inspection: ['inspection', 'controle', 'pharmaciens inspecteurs'],
        ordre: ['ordre des pharmaciens', 'conseils regionaux', 'conseil national'],
        deontologie: ['deontologie', 'code de deontologie'],
        hospitaliere: ['pharmacie hospitaliere', 'services de pharmacie'],
        exercice: ['autorisation', 'exercice de la pharmacie', 'equivalence'],
        absence: ['absence du pharmacien', 'remplacement'],
    };

    const patterns = byIntent[intent] || [];
    return patterns.some((pattern) => corpus.includes(pattern));
}

function retrieveLegalChunks(question, langCode) {
    const chunks = loadLegalChunks();
    if (!chunks.length) {
        return [];
    }

    const normalizedQuestion = normalizeText(question);
    const tokens = tokenizeSearch(question);
    const intent = detectLegalIntent(tokens);
    const intentFilteredChunks = intent
        ? chunks.filter((chunk) => matchesLegalIntent(chunk, intent))
        : [];
    const candidateChunks = intentFilteredChunks.length ? intentFilteredChunks : chunks;

    return candidateChunks
        .map((chunk) => ({ chunk, score: scoreLegalChunk(chunk, tokens, normalizedQuestion, langCode) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, MAX_LEGAL_CHUNKS)
        .map((entry) => entry.chunk);
}

function buildLegalContext(question, langCode) {
    const chunks = retrieveLegalChunks(question, langCode);
    if (!chunks.length) {
        return { context: '', chunks: [] };
    }

    const parts = [];
    let currentLength = 0;

    chunks.forEach((chunk, index) => {
        const warnings = [];
        if (chunk.confidence) {
            warnings.push(`confidence=${chunk.confidence}`);
        }
        if (chunk.manual_review_required) {
            warnings.push('manual_review_required=true');
        }

        const block = [
            `[${index + 1}] ${chunk.citation_label || chunk.chunk_id}`,
            `Titre: ${chunk.official_title || chunk.short_title || chunk.doc_id}`,
            `Type: ${chunk.document_type || 'inconnu'}`,
            `Langue: ${chunk.language || 'unknown'}`,
            `Structure: ${chunk.structure_path || 'unnamed_section'}`,
            `Pages: ${chunk.page_start || '?'}-${chunk.page_end || '?'}`,
            warnings.length ? `Avertissements: ${warnings.join(', ')}` : null,
            chunk.legal_summary ? `Résumé: ${chunk.legal_summary}` : null,
            chunk.key_rules?.length ? `Règles clés: ${chunk.key_rules.slice(0, 3).join(' | ')}` : null,
            `Texte source: ${(chunk.clean_text || chunk.text || '').slice(0, 1400)}`,
        ].filter(Boolean).join('\n');

        if (currentLength + block.length <= MAX_LEGAL_CONTEXT_CHARS) {
            parts.push(block);
            currentLength += block.length + 2;
        }
    });

    return {
        context: parts.join('\n\n'),
        chunks,
    };
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
    _azureClient = new AzureOpenAI({ apiKey, endpoint, apiVersion, timeout: 22000, maxRetries: 0 });
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
    const lang = detectLanguage(question);
    const labels = getStructuredLabels(lang.code);
    const scopeLabel = buildScopeLabel(scope);

    if (!context) {
        return formatStructuredAnswer(lang.code, {
            shortAnswer: labels.noSource,
            foundationLines: [`Aucun extrait n'est actuellement chargé pour le thème ${scopeLabel}.`],
            limitLines: [labels.verify],
            sourceLines: [],
        });
    }

    const normalizedQuestion = normalizeText(question);

    if (looksLikeGeneralFseQuestion(normalizedQuestion, normalizeScope(scope))) {
        return formatStructuredAnswer(lang.code, {
            shortAnswer: buildGeneralFseSummary(context),
            foundationLines: ['Résumé opérationnel extrait de la FAQ FSE disponible dans la base.'],
            limitLines: [labels.faqNotice, labels.verify],
            sourceLines: ['fse_faq.md'],
        });
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
        if (/obligatoir/.test(keyword)) {
            ['pilote', 'phase', 'obligatoire', 'generalisation', 'encore'].forEach((value) => expandedKeywords.add(value));
        }
    });

    const sections = extractMarkdownSections(context);
    let bestSection = null;
    let bestScore = 0;

    sections.forEach((section) => {
        const normalizedTitle = normalizeText(section.title);
        const haystack = normalizedTitle + ' ' + normalizeText(section.content.join(' '));
        let score = 0;

        expandedKeywords.forEach((kw) => {
            if (normalizedTitle.includes(kw)) {
                score += 6; // Title match — much more specific than body
            } else if (haystack.includes(kw)) {
                score += 2;
            }
        });

        if (section.title && normalizedQuestion.includes(normalizedTitle)) {
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
            return formatStructuredAnswer(lang.code, {
                shortAnswer: preview,
                foundationLines: [
                    bestSection.title
                        ? `Extrait retenu : ${bestSection.title}`
                        : `Extrait retenu dans la base ${scopeLabel}.`,
                    preview,
                ],
                limitLines: [labels.faqNotice, labels.verify],
                sourceLines: [
                    [bestSection.sourceFile, bestSection.title].filter(Boolean).join(' — '),
                ],
            });
        }
    }

    return formatStructuredAnswer(lang.code, {
        shortAnswer: labels.noSource,
        foundationLines: [`Aucun extrait suffisamment pertinent n'a été retrouvé dans la base ${scopeLabel}.`],
        limitLines: [labels.verify],
        sourceLines: [],
    });
}

async function fallbackLegalSearch(question, scope) {
    const lang = detectLanguage(question);
    const parsedQuery = legalKb.parseQueryFeatures(question);
    const labelOptions = { practical: Boolean(parsedQuery.asksAboutPractical), legal: true };
    const labels = getStructuredLabels(lang.code, labelOptions);

    try {
        const retrieval = await legalKb.retrieveLegalResults(question, {
            scope,
            langCode: lang.code,
            topK: parsedQuery.asksAboutPractical ? Math.max(MAX_LEGAL_CHUNKS, 6) : MAX_LEGAL_CHUNKS,
        });
        const chunks = retrieval.results.map((entry) => entry.chunk);

        if (chunks.length) {
            return formatStructuredLegalAnswerFromChunks(chunks, lang.code, labelOptions);
        }
    } catch (error) {
        console.error('[CNSS] Recherche juridique avancée indisponible:', error.message || error);
    }

    const legacyChunks = retrieveLegalChunks(question, lang.code);
    if (legacyChunks.length) {
        return formatStructuredLegalAnswerFromChunks(
            legacyChunks,
            lang.code,
            labelOptions,
            [getLegalSearchFallbackNotice(lang.code)],
        );
    }

    return formatStructuredAnswer(lang.code, {
        shortAnswer: labels.noSource,
        foundationLines: [getLegalSearchUnavailableLine(lang.code)],
        limitLines: [labels.verify],
        sourceLines: [],
        labelOptions,
    });
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
    // Indicateurs espagnols fiables uniquement (¿ ¡ ñ) ou mots exclusivement espagnols
    if (/[¿¡ñÑ]/.test(text) || /\b(usted|farmacéutico|boticario|explicame|explíqueme|explíca|dígame|cómo|cuál|cuánto|hola|gracias)\b/i.test(text)) {
        return { code: 'es', label: 'espagnol' };
    }
    return { code: 'fr', label: 'français' };
}

async function answerQuestion(question, scope, userLang = null) {
    const client = getAzureClient();
    const scopeLabel = buildScopeLabel(scope);
    const normalizedScope = normalizeScope(scope);
    // Use stored user language if provided; fall back to text-based detection
    const langMap = { ar: { code: 'ar', label: 'arabe (العربية)' }, es: { code: 'es', label: 'espagnol' }, ru: { code: 'ru', label: 'russe (русский)' }, fr: { code: 'fr', label: 'français' } };
    const lang = (userLang && langMap[userLang]) || detectLanguage(question);
    const useLegalKb = legalKb.shouldUseLegalKb(normalizedScope);
    const parsedLegalQuery = useLegalKb ? legalKb.parseQueryFeatures(question) : null;
    const legalTopK = parsedLegalQuery?.asksAboutPractical ? Math.max(MAX_LEGAL_CHUNKS, 6) : MAX_LEGAL_CHUNKS;

    if (!client) {
        console.warn('[CNSS] Azure OpenAI non configuré, basculement en mode dégradé.');
        return useLegalKb ? await fallbackLegalSearch(question, normalizedScope) : fallbackKeywordSearch(question, scope);
    }

    const langInstruction = `INSTRUCTION IMPÉRATIVE : Tu dois répondre UNIQUEMENT en ${lang.label}. Pas en français, pas dans une autre langue — en ${lang.label} exclusivement.`;
    let legalRetrieval = null;
    let legalContext = null;

    if (useLegalKb) {
        try {
            legalRetrieval = await legalKb.retrieveLegalResults(question, {
                scope: normalizedScope,
                langCode: lang.code,
                topK: legalTopK,
            });
            legalContext = {
                context: legalKb.buildLegalContext(legalRetrieval.results, { maxChars: MAX_LEGAL_CONTEXT_CHARS }),
                results: legalRetrieval.results,
            };
        } catch (error) {
            console.error('[CNSS] Erreur lors de la récupération juridique:', error.message || error);
            return await fallbackLegalSearch(question, normalizedScope);
        }
    }
    const faqContext = useLegalKb ? '' : loadFaqContext(scope);
    const contextBlock = useLegalKb ? legalContext.context : faqContext;

    if (useLegalKb && !contextBlock) {
        return await fallbackLegalSearch(question, normalizedScope);
    }

    if (!useLegalKb && !contextBlock) {
        return fallbackKeywordSearch(question, scope);
    }

    const answerStyleInstruction = useLegalKb
        ? buildLegalAnswerStyleInstruction(lang.code, legalRetrieval)
        : '';
    const citationInstruction = useLegalKb
        ? `Tu peux utiliser les repères internes [R1], [R2], etc. pour raisonner, mais tu ne dois jamais les afficher tels quels dans la réponse finale.`
        : '';
    const legalReferenceBlock = useLegalKb
        ? `\nRéférences candidates :\n${legalContext.results.map((entry, index) => `[R${index + 1}] ${legalKb.buildCitationLabel(entry.chunk)}`).join('\n')}`
        : '';

    const userContent = `${langInstruction}

Thème actuel : ${scopeLabel}.
Tu dois répondre UNIQUEMENT aux questions relevant de ce thème en utilisant le contexte ci-dessous.
Ne redirige pas vers ce thème si l'utilisateur s'y trouve déjà.
${citationInstruction}
${answerStyleInstruction}

${useLegalKb ? 'Base juridique indexée :' : 'Base documentaire disponible :'}
${contextBlock}${legalReferenceBlock}

Question : ${question}`;

    try {
        console.log(`[CNSS] Appel Azure OpenAI pour : "${question.slice(0, 80)}..."`);

        const completion = await client.chat.completions.create({
            model: getDeployment(),
            messages: [
                { role: 'system', content: buildSystemPrompt(scope) },
                { role: 'user', content: userContent },
            ],
            max_completion_tokens: parsedLegalQuery?.asksAboutPractical ? 700 : 550,
            temperature: 0.2,
            top_p: 1,
        });

        let reply = extractAssistantText(completion.choices[0]?.message);

        if (!reply) {
            console.warn('[CNSS] Réponse vide du modèle, basculement en mode de secours.');
            if (useLegalKb && legalContext?.results?.length) {
                return formatStructuredLegalAnswerFromChunks(
                    legalContext.results.map((r) => r.chunk),
                    lang.code,
                    { practical: Boolean(parsedLegalQuery?.asksAboutPractical), legal: true },
                );
            }
            return useLegalKb ? await fallbackLegalSearch(question, normalizedScope) : fallbackKeywordSearch(question, scope);
        }

        if (useLegalKb) {
            reply = postProcessLegalReply(reply, legalRetrieval.results, lang.code, {
                practical: Boolean(parsedLegalQuery?.asksAboutPractical),
                legal: true,
            });
        }

        // Tronquer si trop long pour WhatsApp
        if (reply.length > MAX_RESPONSE_CHARS) {
            reply = reply.slice(0, MAX_RESPONSE_CHARS - 30) + '\n\n[Suite : cnss.ma]';
        }

        console.log(`[CNSS] Réponse générée (${reply.length} chars)`);

        // Fire-and-forget quality scoring — does not block the WhatsApp reply
        if (useLegalKb && legalContext?.results?.length) {
            const contextIds = legalContext.results.map((r) => r.chunk?.chunk_id).filter(Boolean);
            setImmediate(() => {
                qualityScorer.scoreAnswer(question, reply, legalContext.results)
                    .then((quality) => {
                        if (!quality) return;
                        return supabaseKb.logQuality({
                            phone: null,
                            question,
                            answer: reply,
                            contextIds,
                            score: quality.score,
                            dims: quality.dims,
                            retried: false,
                            flagged: quality.flagged,
                            scope: normalizedScope,
                            lang: lang.code,
                        });
                    })
                    .catch(() => {});
            });
        }

        return reply;

    } catch (error) {
        console.error('[CNSS] Erreur Azure OpenAI:', error.message || error);

        // Si on a déjà les chunks du KB, les formater directement sans re-fetcher
        if (useLegalKb && legalContext?.results?.length) {
            return formatStructuredLegalAnswerFromChunks(
                legalContext.results.map((r) => r.chunk),
                lang.code,
                { practical: Boolean(parsedLegalQuery?.asksAboutPractical), legal: true },
            );
        }
        const fallback = useLegalKb ? await fallbackLegalSearch(question, normalizedScope) : fallbackKeywordSearch(question, scope);
        return fallback;
    }
}

// ─── PROMPT D'INVITATION ──────────────────────────────────────────────────────

const CNSS_PROMPT_TEXTS = {
    fse: {
        fr: 'Posez votre question sur la FSE : fonctionnement, phase pilote, déploiement, impact en pharmacie...\n\nExemple : "La FSE est-elle obligatoire dès maintenant ?"',
        ar: 'اطرح سؤالك حول الورقة الإلكترونية للعلاجات (FSE): الأداء، المرحلة التجريبية، النشر، التأثير على الصيدلية...\n\nمثال: "هل أصبح تطبيق FSE إلزامياً الآن؟"',
        es: 'Haga su pregunta sobre la FSE: funcionamiento, fase piloto, despliegue, impacto en farmacia...\n\nEjemplo: "¿La FSE ya es obligatoria?"',
        ru: 'Задайте вопрос об ЭЛН (FSE): работа, пилотная фаза, развёртывание, влияние на аптеку...\n\nПример: "FSE уже обязательна?"',
    },
    conformites: {
        fr: "Posez votre question sur les textes législatifs, la conformité CNDP/CNSS, le droit du travail ou la réglementation officinale : inspection, stupéfiants, CNDP, salaires, licenciement, Loi 17-04...\n\nExemple : \"J'ai une inspection, qu'est-ce que je fais ?\"",
        ar: 'اطرح سؤالك حول النصوص التشريعية، مطابقة CNDP/CNSS، قانون العمل أو التنظيم الصيدلاني: التفتيش، المخدرات، الأجور، الفصل، القانون 17-04...\n\nمثال: "عندي تفتيش، ماذا أفعل؟"',
        es: 'Haga su pregunta sobre textos legislativos, conformidad CNDP/CNSS, derecho laboral o regulación: inspección, estupefacientes, salarios, despido, Ley 17-04...\n\nEjemplo: "Tengo una inspección, ¿qué hago?"',
        ru: 'Задайте вопрос о законодательных текстах, соответствии CNDP/CNSS, трудовом праве или аптечных нормах: инспекция, наркотики, зарплаты, увольнение, Закон 17-04...\n\nПример: "У меня проверка, что делать?"',
    },
    default: {
        fr: 'Posez votre question sur la CNSS : remboursements, affiliations, cotisations, prestations...\n\nExemple : "Comment déclarer un employé à la CNSS ?"',
        ar: 'اطرح سؤالك حول CNSS: التعويضات، التسجيل، الاشتراكات، الخدمات...\n\nمثال: "كيف أسجل موظفاً في CNSS؟"',
        es: 'Haga su pregunta sobre la CNSS: reembolsos, afiliaciones, cotizaciones, prestaciones...\n\nEjemplo: "¿Cómo declarar a un empleado en la CNSS?"',
        ru: 'Задайте вопрос о CNSS: возмещения, аффилиации, взносы, льготы...\n\nПример: "Как зарегистрировать сотрудника в CNSS?"',
    },
};

const CNSS_PROMPT_HEADER = { fr: 'Posez votre question', ar: 'اطرح سؤالك', es: 'Haga su pregunta', ru: 'Задайте вопрос' };
const CNSS_PROMPT_BACK = {
    fr: 'Envoyez RETOUR pour revenir au menu.',
    ar: 'أرسل RETOUR للعودة إلى القائمة.',
    es: 'Envíe RETOUR para volver al menú.',
    ru: 'Отправьте RETOUR для возврата в меню.',
};

function buildCnssQuestionPrompt(theme, lang = 'fr') {
    const themeId = theme && theme.id;
    const themeKey = (themeId === 'conformites' || themeId === 'compliance' || themeId === 'regulations') ? 'conformites' : (themeId || 'default');
    const prompts = CNSS_PROMPT_TEXTS[themeKey] || CNSS_PROMPT_TEXTS.default;
    const promptText = prompts[lang] || prompts.fr;
    const header = CNSS_PROMPT_HEADER[lang] || CNSS_PROMPT_HEADER.fr;
    const back = CNSS_PROMPT_BACK[lang] || CNSS_PROMPT_BACK.fr;

    return [`${theme.title} — ${header}`, '', promptText, '', back].join('\n');
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
    answerQuestion,
    buildCnssQuestionPrompt,
    loadFaqContext,
    reloadFaqContext,
    _test: {
        fallbackLegalSearch,
        buildPracticalShortLines,
        buildLegalAnswerStyleInstruction,
        getStructuredLabels,
        postProcessLegalReply,
        replaceReferencePlaceholders,
        extractAssistantText,
    },
};
