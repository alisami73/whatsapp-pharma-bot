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
