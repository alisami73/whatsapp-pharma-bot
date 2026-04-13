# CHAT ALI — whatsapp-pharma-bot

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
- Nouvel état `AWAITING_CNSS_QUESTION` dans index.js
- Thème `cnss` ajouté dans themes.json (module_type: 'cnss')
- L'utilisateur reste en mode question CNSS jusqu'à RETOUR (conversation libre)

### Décisions / Priorités
- Architecture : Node.js + Express, JSON storage — ne pas changer
- Le nouveau module RAG s'appellera `modules/rag.js`
- Un nouveau `module_type: 'cnss'` (ou enrichissement de `knowledge_base`) dans themes.json
- Intégration dans la machine d'états existante

### À retenir pour la prochaine session
- Attendre les 3 réponses d'Ali avant de coder le module RAG
- Si Azure OpenAI : reprendre exactement la structure de agentService.ts (AzureChatOpenAI, classifier léger, réponse directe)
- Si OpenAI direct : même pattern avec `ChatOpenAI` de @langchain/openai
- Documents CNSS à placer dans `data/knowledge/` (texte extrait) ou traitement PDF au démarrage
- Le module doit fonctionner en mode "sans LLM" (dégradé) si la clé API n'est pas configurée
