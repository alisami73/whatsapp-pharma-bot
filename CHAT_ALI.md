# CHAT ALI — whatsapp-pharma-bot

## [2026-04-26] — Suppression étape rôle de l'onboarding + fix carousel Explorer

### Résumé
Deux sujets principaux ce jour :

**1. Carousel Explorer (session précédente)**
- Root cause : images carousel 1.2–1.6 MB → erreur 63019 (WhatsApp rejette silencieusement)
- Fix : compression images à 37-52 KB (même filenames/URLs) via `sips`
- Les SIDs v1 approuvés par Meta (`APPROVED_CAROUSEL_SIDS`) sont conservés en dur dans `modules/explorer/index.js`
- Résultat confirmé : `status: read`, carousel 5 cartes reçu par l'utilisateur ✅

**2. Suppression de l'étape rôle (ce sujet)**
- L'écran "Quel est votre rôle ?" (list-picker 3 choix) a été supprimé du parcours onboarding
- Nouveau flux : Langue → CGU → **Explorer carousel directement**
- L'utilisateur n'a plus à choisir "Titulaire / Adjoint / Autre"

### Décisions / Priorités
- Ne plus jamais proposer de list-picker comme alternative à un carousel
- Onboarding simplifié : 2 étapes seulement (langue + CGU) puis carousel
- Les messages `onboarding_complete` mis à jour dans les 4 langues (suppression "Profil enregistré")

### Fichiers modifiés
- `index.js` : bloc CGU accept → remplacé `ONBOARDING_ROLE` par saut direct vers l'Explorer carousel
- `locales/fr.json`, `ar.json`, `es.json`, `ru.json` : message `onboarding_complete` simplifié

### À retenir pour la prochaine session
- Le handler `ONBOARDING_ROLE` existe encore dans `handleOnboardingStep` (safety net pour users bloqués) — peut être nettoyé plus tard
- Les templates Twilio v2/v3 créés pendant le debug du carousel sont inutilisés (peuvent être supprimés de la console Twilio)
- Table Supabase `chatbot_answer_history` toujours en attente de création

---

## [2026-04-24] — Fix Azure OpenAI : gpt-4o-mini ne répondait plus (Conformité + FSE)

### Résumé
Après rollback `gpt-5.4-mini` → `gpt-4o-mini`, les deux modules (FSE et Conformité) retournaient des réponses fallback au lieu de réponses Azure. Deux bugs distincts identifiés et corrigés.

**Bug 1 — `max_completion_tokens` au lieu de `max_tokens`**
- `max_completion_tokens` est le paramètre o-series (o1, o3). `gpt-4o-mini` utilise `max_tokens`.
- Avec le mauvais paramètre, Azure échoue silencieusement → fallback local.
- Fix : `modules/cnss.js` — renommé `max_completion_tokens` → `max_tokens`. Commité `a0250bf`.

**Bug 2 — `AZURE_OPENAI_API_VERSION=2024-07-18` invalide**
- L'utilisateur avait mis la **version du modèle** (snapshot Azure portal) à la place de la **version de l'API REST**.
- `2024-07-18` n'est pas un API version valide → SDK échoue silencieusement.
- Fix : Changé vers `2024-08-01-preview` dans Railway + Vercel + `.env`.

**Bug 3 (session précédente) — Supabase free tier pause → TCP hang**
- Supabase inactive → connexion TCP bloquée indéfiniment → timeout Twilio.
- Fix : `Promise.race` avec 5s cap sur `supabaseKb.searchChunks()` dans `legal_kb.js`.

**Bug 4 (session précédente) — `gpt-5.4-mini` refuse les questions légales**
- Ce modèle applique une politique contenu restrictive sur les questions réglementaires.
- `message.content = null`, `message.refusal` set, mais ça répondait pour "bonjour".
- Fix : Rollback vers `gpt-4o-mini`.

### Décisions
- `AZURE_OPENAI_API_VERSION` = `2024-08-01-preview` pour `gpt-4o-mini` (à ne pas confondre avec la version snapshot du modèle dans Azure portal)
- Température fixée à `0.7`, `top_p` supprimé
- Logging ajouté : `finish_reason` + `refusal` loggé si non "stop"

### À retenir pour la prochaine session
- Il y a DEUX versions Azure distinctes :
  1. **Version snapshot modèle** (dans Azure portal, ex: `2024-07-18`) → ne pas mettre en env var
  2. **API version** (`AZURE_OPENAI_API_VERSION`) → doit être `2024-08-01-preview` pour gpt-4o-mini
- `gpt-5.4-mini` ne répond pas aux questions légales (content filter) → ne pas utiliser
- Si Azure échoue silencieusement → vérifier d'abord ces deux valeurs avant tout debug

---

## [2026-04-24] — Fix FSE "obligatoire" : mauvaise section retournée

### Résumé
Bug prod : la question "La FSE est-elle obligatoire dès maintenant ?" retournait la section "2. Comment cela va fonctionner ?" au lieu de la réponse sur la phase pilote.

**Cause identifiée :**
- Bot en mode `fallbackKeywordSearch` (Azure OpenAI non disponible ou call échoue en prod)
- L'expansion "fse" → `['feuille', 'soins', 'electronique', 'pharmacie', 'qr', 'code']` faisait scorer la section "2." à 12 pts
- La section "Phase pilote" scorait seulement 4 pts car "obligatoire" n'y apparaissait pas
- Le scoring ne boostait pas les correspondances dans les TITRES de section

**Fix appliqué :**
1. `data/knowledge/fse_faq.md` — ajout section explicite "La FSE est-elle déjà obligatoire ?" (FR + AR) avec réponse directe "Non, phase pilote"
2. `modules/cnss.js` → `fallbackKeywordSearch` :
   - Expansion "obligatoire" → `['pilote', 'phase', 'obligatoire', 'generalisation', 'encore']`
   - Scoring titre : match dans le titre → +6 (au lieu de +2 en body), exclusif (pas de double-comptage)
   - Résultat : la nouvelle section "obligatoire" score 34 pts vs 14 pour "Comment ça marche"

### Décisions
- L'expansion "fse" dans `fallbackKeywordSearch` reste utile pour le body, mais le boost titre la surpasse pour les questions ciblées
- FAQ FSE mise à jour = fix qui fonctionne même si Azure OpenAI est indisponible

### À retenir pour la prochaine session
- `gpt-5.4-mini` est le bon nom de déploiement — confirmé dans Azure Foundry
- `AZURE_OPENAI_API_VERSION=2026-03-17` — probablement valide (embedding pipeline a fonctionné avec cette version)
- Pattern de bug : keyword expansion sur un terme générique ("fse") peut polluer le scoring de section → préférer boost sur les titres

---

## [2026-04-24] — Fix Conformité : timeout Twilio + double appel retrieveLegalResults

### Résumé
Le module Conformité ne répondait pas du tout. Cause : le webhook Twilio (limite 30 secondes) expirait avant la réponse.

**Chaîne de temps pour une question Conformité (avant fix) :**
1. `retrieveLegalResults` #1 : embedding (∞) + Supabase → jusqu'à ∞ sans timeout
2. Si Azure chat échoue → `fallbackLegalSearch` appelle `retrieveLegalResults` #2 : embedding (∞) à nouveau
3. Total potentiel >> 30 secondes → Twilio expire → user reçoit rien

**Fix appliqué :**
1. `legal_kb.js` → `getEmbeddingClient()` : `timeout: 8000, maxRetries: 0`
2. `cnss.js` → `getAzureClient()` : `timeout: 22000, maxRetries: 0`
3. `cnss.js` → quand Azure chat échoue ET qu'on a déjà `legalContext.results` → utilise les chunks déjà récupérés sans re-appeler `retrieveLegalResults` (évite le double coût)

**Pire cas après fix :** 8s (embedding) + 22s (chat) = 30s → dans la limite Twilio. En practice : 3-8s (embedding) + 8-15s (chat) = 11-23s.

### Décisions
- Pas de modification de `AZURE_OPENAI_API_VERSION` — `2026-03-17` fonctionne pour les embeddings → probablement valide
- Double-appel à `retrieveLegalResults` conservé dans `fallbackLegalSearch` mais shorcircuité si les résultats sont déjà disponibles

### À retenir
- Si les timeouts sont trop courts → augmenter `timeout` dans `getAzureClient` et `getEmbeddingClient`
- Si le problème persiste → regarder les logs Railway pour voir l'erreur exacte

---

## [2026-04-23] — RAG Production : Supabase pgvector + Quality Scoring (session 2)

### Résumé
RAG production entièrement opérationnel en fin de session.

**Architecture déployée :**
- `scripts/supabase_schema.sql` — tables `legal_chunks` (VECTOR 1536) + `hybrid_search` RPC + `rag_quality_logs`
- `modules/supabase_kb.js` — client Supabase, hybrid search, quality log insert, upsert batch
- `modules/quality_scorer.js` — scoring 0–100 sur 6 dimensions (GPT, fire-and-forget)
- `scripts/embed_and_upload.js` — 1005 chunks embeddés via Azure text-embedding-3-small → Supabase
- `modules/legal_kb.js` — Supabase comme provider vecteur (fallback BM25 local si vide)
- `modules/cnss.js` — quality log fire-and-forget après chaque réponse légale

**Résultats vérifiés :**
- 1005/1005 chunks dans Supabase avec embeddings
- Retrieval provider = `supabase` sur toutes les requêtes test
- Scores de pertinence : 0.29–0.61 selon la requête
- Env vars déployées sur Railway

**Commits :** `94ab8f7`, `39b7bef`

### Décisions
- Service role key = seule clé nécessaire côté serveur (bypasse RLS)
- Pas de direct PostgreSQL access sans DB password → schéma appliqué via SQL editor Supabase (manuel)
- Quality scoring fire-and-forget : aucune latence ajoutée côté WhatsApp
- BM25 local toujours actif pour le composant lexical — Supabase pour le vecteur uniquement

### À retenir pour la prochaine session
- `rag_quality_logs` table active — après quelques jours d'utilisation, consulter les réponses `flagged=true` ou `quality_score < 75` dans Supabase table editor pour identifier les faiblesses du RAG
- Pour ajouter de nouveaux documents KB : (1) créer le `.chunks.json`, (2) injecter dans `legal_hybrid_index.json`, (3) relancer `npm run kb:embed` → Supabase mis à jour automatiquement
- `pg` installé en devDependency (pour migrations futures directes si DB password disponible)

---

## [2026-04-23] — FAQ sub-menus Blink Premium + Inspection KB + Emojis rôles

### Résumé
Session dense — 5 chantiers terminés.

**Chantier 1 — FAQ interactives carrousel Blink Premium (terminé)**
- Renommé "Être rappelé" → "Appelez-moi" avec sous-menu 2 options : 🎯 Démo / ❓ Renseignement
- "Pourquoi Blink ?" → list-picker 10 items (2 sections) : q1–q8 + Medindex + IA
- "Mes données & CNDP" → list-picker 5 items : sécurité, permission, loi 09-08, contrôle, règles
- 3 nouveaux états : BROWSING_SW_CALLBACK_SUB, BROWSING_SW_BENEFITS_FAQ, BROWSING_SW_DATA_FAQ
- RETOUR depuis sous-états → retour au carrousel software
- 4 langues : FR/AR/ES/RU — tous les locale keys ajoutés

**Chantier 2 — Drapeaux sur sélection de langue (terminé)**
- `language_body` mis à jour avec 🇫🇷🇲🇦🇪🇸🇷🇺 dans tous les locales
- Template bumped → `blink_language_v2`

**Chantier 3 — Emojis menu sélection rôle (terminé — commité 2026-04-23)**
- 🏥 Pharmacien titulaire / 💊 Adjoint / 👤 Autre — dans les 4 langues
- Template bumped → `blink_role_v3`
- Commit : `2561126`

**Chantier 4 — Knowledge base inspection pharmacie (terminé)**
- Document "Guide pratique — Se préparer à une inspection AMMPS" ingéré en 4 chunks
- `data/legal_kb/chunks/guide_inspection_pratique_ammps.chunks.json` créé
- 4 chunks injectés dans `legal_hybrid_index.json` (1001→1005 entrées)
- Scores de retrieval : 0.44–0.59 (top résultats pour toutes les requêtes inspection)
- Commit : `c7c151a`

**Chantier 5 — Architecture RAG production (design fourni, non implémenté)**
- 15 livrables décrits : Supabase schema, TypeScript pipeline, admin dashboard Vercel
- Embeddings : text-embedding-3-small (1536 dims), GPT-4o-mini pour génération, GPT-4o pour scoring
- Scoring qualité 0–100 sur 6 dimensions, seuil 75
- PAS encore implémenté dans le code — design seulement

### Décisions / Priorités
- Déploiement : Railway (pas Vercel — filesystem writable requis)
- Stockage : JSON files (pas de migration DB prévue sauf RAG Supabase)
- RAG Supabase : si Ali veut implémenter → prochain chantier prioritaire

### À retenir pour la prochaine session
- RAG production non implémenté — si requis : setup Supabase + ingest pipeline KB existant
- Template Twilio role v3 actif — si problème d'affichage, vider cache `data/interactive_templates.json`
- Le fichier `data/legal_kb/indexes/legal_hybrid_index.json` est la source autoritaire du RAG (pas les chunks/*.json)

## [2026-04-12] — Consentement/Onboarding + Recherche Agent + RAG CNSS

### Résumé
Session très dense. Deux grands chantiers terminés, un en cours.

**Chantier 1 — Consentement & Onboarding (terminé)**
- Flux complet OUI / NON / EN SAVOIR PLUS
- Versioning consentement (CONSENT_CURRENT_VERSION) — re-demande si version change
- Rôles pharmacien : titulaire / adjoint / autre (ONBOARDING_ROLE = 1ère étape onboarding)
- Stockage enrichi dans consents.json : consent_status, consent_version, text snapshot, accepted_at/refused_at/revoked_at, role_declared
- 6 templates Meta WhatsApp (UTILITY) définis dans modules/consent.js
- Commandes PROFIL et AIDE
- Admin : colonne Rôle + badge Consentement dans CRM, endpoint GET /api/consent/status/:phone
- Bug corrigé : ONBOARDING_ROLE intercepté par isNumberSelection → déplacé le bloc onboarding AVANT isNumberSelection

**Chantier 2 — Recherche agent IA (terminé)**
- Trouvé deux agents dans les dépôts Blink Pharma :
  1. `Blink-Pharma/whatsapp-api` → WhatsappWebhookController.php (PHP/Laravel, keyword-based)
  2. `Blink-Pharma/blink-ai-api-service` → src/services/agentService.ts (TypeScript, Azure OpenAI + LangGraph + 14 tools)
- Ali veut utiliser le pattern du 2ème (agentService.ts) dans whatsapp-pharma-bot

**Chantier 3 — Module CNSS (terminé)**
- LLM : Azure OpenAI (même config que blink-ai-api-service)
- Documents : .txt/.md dans data/knowledge/
- Volume : petite FAQ → contexte injecté directement dans le prompt (pas d'embeddings)
- `modules/cnss.js` créé : charge FAQ au démarrage (cache), appelle Azure OpenAI, fallback keyword si non configuré
- `data/knowledge/cnss_faq.md` : exemple FAQ CNSS (remboursements, cotisations, AMO, retraite, Damancom)
- `data/knowledge/fse_faq.md` : FAQ FSE bilingue (FR/AR)
- Nouvel état `AWAITING_CNSS_QUESTION` dans index.js
- Thème `cnss` ajouté dans themes.json (module_type: 'cnss')
- L'utilisateur reste en mode question CNSS jusqu'à RETOUR (conversation libre)

**Chantier 4 — Déploiement Railway (terminé)**
- Vercel incompatible (EROFS — filesystem read-only) car le projet utilise JSON file storage
- Migré vers Railway (writable filesystem)
- URL Railway : https://whatsapp-pharma-bot-production.up.railway.app
- Twilio webhook : /webhook/whatsapp → Railway
- Env vars configurées sur Railway

**Chantier 5 — WhatsApp Flow onboarding (en cours / bloqué côté Meta)**
- Flow 4 écrans : language_screen → consent_screen → role_screen → home_screen
- Template SID : HX8f34161797844f68fc1eed1519595c0b
- Sender Twilio : +15559015030 (Assistant Pharmacie Maroc)
- `modules/onboarding_flow.js` créé : parseFlowSubmission, mapRoleChoiceToStoredRole
- Backend prêt : reçoit et stocke consent + role + entry_choice
- **BLOCAGE** : Meta rejette la publication du Flow
  - Statut : Rejected
  - Erreur : OAuthException code=139000, subCode=4233020
  - Message : Blocked by Integrity
  - Ce n'est pas un bug code — c'est un blocage plateforme Meta/WhatsApp

### Décisions / Priorités
- Architecture : Node.js + Express, JSON storage — ne pas changer
- Railway = déploiement production, pas Vercel
- WhatsApp Flow en attente d'approbation Meta — continuer le reste du bot pendant l'attente

### À retenir pour la prochaine session
- Vérifier si le Flow est approuvé (Meta Comptes WhatsApp > Flux)
- Si encore bloqué : Option A = fallback texte/boutons pour l'onboarding sans Flow
- Option B : router vers le bon thème après soumission Flow (entry_choice)
- Le fichier `api/index.js` a été simplifié (5 lignes) — délègue tout à index.js principal

## [2026-04-15] — Debug webhook + blocage Twilio 63112

### Résumé
Session de debug complète. Problème identifié et isolé à chaque couche.

**Diagnostic étape par étape :**
1. Twilio webhook URL → pointait encore vers Vercel (ancienne URL). Corrigé : mis à jour vers `https://whatsapp-pharma-bot-production.up.railway.app/webhook/whatsapp`
2. Code déployé sur Railway avec les 3 commits (fallback texte + UX Blink Premium)
3. Railway reçoit bien les webhooks Twilio (confirmé via HTTP Logs Railway)
4. Le bot reçoit et traite les messages correctement (webhook retourne 200 avec TwiML valide)
5. **BLOCAGE FINAL : Twilio error 63112** — Twilio reçoit le TwiML mais échoue à livrer le message WhatsApp

**Cause identifiée :**
- Error 63112 = sender WhatsApp (+15559015030, numéro US) non autorisé à envoyer vers les numéros Marocains (+212)
- Restriction régionale ou compte WhatsApp Business non approuvé pour le Maroc
- Le compte Twilio "Assistant Pharmacie" (AC95...) créé le 7 avril 2026 est trop récent

**Le code est correct — le problème est 100% Twilio/WhatsApp Business Account.**

### Décisions / Priorités
- Acheter un numéro marocain WhatsApp Business comme sender (remplace +15559015030)
- Un numéro local (+212) sera plus adapté pour les pharmacies marocaines et évitera les restrictions régionales

### À retenir pour la prochaine session
- Tout le code est correct et déployé sur Railway
- Seul bloquer restant : sender Twilio WhatsApp avec numéro marocain
- Quand le nouveau numéro est prêt : le configurer dans TWILIO_WHATSAPP_FROM ou TWILIO_MESSAGING_SERVICE_SID
- Mettre à jour le webhook URL sur le nouveau sender dans Twilio Console
- Tester avec +212661095271 : Bonjour → consentement texte → "1" → role → FSE chat

## [2026-04-18] — Onboarding multilingue + Footer + Thèmes (Spec 1 & 2)

### Résumé
Deux grandes sessions de travail qui ont complètement refactorisé l'onboarding et les thèmes.

**Bug corrigé (sessions précédentes) :**
- Messages interactifs WhatsApp ne s'affichaient pas (boutons absents → fallback texte)
- Causes : champ `language` manquant dans les specs Content API Twilio + mauvais sender (sandbox US au lieu de +212768782598)
- Fix : ajout `language` dans toutes les specs + bypass `messagingServiceSid` → utiliser `whatsappFrom` directement

**Spec 1 — Onboarding multilingue (terminé) :**
- Écran 1 : sélection langue (AR/FR/ES/RU) via `twilio/list-picker` — état `AWAITING_LANGUAGE`
- Écran 2 : CGU dans la langue choisie avec 3 boutons (cgu_accept / cgu_decline / cgu_full)
- Écran 3 : menu des thèmes dans la langue choisie
- Système i18n : `modules/i18n.js` + `locales/{fr,ar,es,ru}.json`
- Commandes globales : `/LANGUE` (reset langue), `/START` (reset total)
- Footer global : `back_to_themes` + `back_to_language` depuis n'importe quel état authentifié
- Reset complet : users.json, consents.json, pharmacists.json, subscriptions.json, interactive_templates.json

**Spec 2 — Thèmes et footer (terminé) :**
- 6 thèmes finaux : software, nouveautes-medicaments, fse, compliance, regulations, medindex
- Fusion CNDP + CNSS → thème `compliance` (module_type: 'cnss', scopes: ['cndp', 'cnss'])
- Footer systématique : chaque réponse IA envoyée via `modules/shared/footer.js` (sendAIResponseWithFooter)
  - Template `blink_footer_v1_{lang}` avec body `{{1}}` + 2 boutons statiques
  - Réponse IA injectée via contentVariables `{"1": text}`
- Software : carrousel `twilio/list-picker` 3 sous-actions (sw_call_me, sw_benefits, sw_data_protection)
  - sw_call_me → envoie WhatsApp à +212661095271 + confirm à l'utilisateur
- Medindex + Regulations → "Bientôt disponible" avec footer
- Regulations KB à fournir (Ali dit "demain")

**Fichiers créés :**
- `modules/i18n.js`
- `locales/fr.json`, `locales/ar.json`, `locales/es.json`, `locales/ru.json`
- `modules/shared/footer.js`
- `modules/themes/software.js`
- `modules/themes/coming-soon.js`

### Décisions / Priorités
- Sender : `TWILIO_WHATSAPP_FROM=+212768782598` sur Railway (jamais `messagingServiceSid` pour les outbound interactifs)
- Template caching : `data/interactive_templates.json` avec TTL 30 jours
- Architecture footer : un seul template par langue, réponse injectée dynamiquement via `{{1}}`
- `INTERACTIVE_MESSAGES_ENABLED=true` sur Railway pour activer les boutons

### À retenir pour la prochaine session
- Tester le flux complet : STOP → Bonjour → sélection langue → CGU → rôle → menu → software carrousel → "Appelez-moi"
- KB Regulations à intégrer dès réception (Ali le fournit) : l'ajouter dans `data/knowledge/` et activer `allow_free_question: true` dans themes.json
- Thème `nouveautes-medicaments` : spec prévoit un tableau dynamique — non implémenté, reporté
- Commit et push à faire
