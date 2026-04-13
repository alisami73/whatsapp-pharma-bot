# Guide d'installation et d'exploitation

## Table des matières

1. [Prérequis](#prérequis)
2. [Installation locale](#installation-locale)
3. [Configuration Twilio WhatsApp](#configuration-twilio-whatsapp)
4. [Variables d'environnement](#variables-denvironnement)
5. [Déploiement](#déploiement)
6. [URLs Twilio à configurer](#urls-twilio-à-configurer)
7. [Modules optionnels](#modules-optionnels)
8. [Administration](#administration)
9. [Sécurité](#sécurité)

---

## Prérequis

- Node.js >= 18
- npm >= 9
- Un compte Twilio actif avec WhatsApp Business API activé
- (Optionnel) Compte Vercel pour le déploiement cloud

---

## Installation locale

```bash
# 1. Cloner le dépôt
git clone <url-repo>
cd whatsapp-pharma-bot

# 2. Installer les dépendances
npm install

# 3. Créer le fichier d'environnement
cp .env.example .env
# Remplir les valeurs dans .env (voir section Variables d'environnement)

# 4. Lancer le serveur de développement
node index.js
# → Serveur sur http://localhost:3000
# → Admin sur http://localhost:3000/admin
```

### Exposer le webhook localement (pour tester avec Twilio)

Twilio a besoin d'une URL HTTPS publique. Utilisez [ngrok](https://ngrok.com/) :

```bash
# Terminal 1 : lancer le bot
node index.js

# Terminal 2 : créer un tunnel ngrok
npx ngrok http 3000
# → Copier l'URL HTTPS fournie (ex: https://abc123.ngrok.io)
```

Définir `PUBLIC_BASE_URL=https://abc123.ngrok.io` dans `.env` et configurer l'URL dans Twilio (voir section suivante).

---

## Configuration Twilio WhatsApp

### Étape 1 — Sandbox WhatsApp (développement)

1. Connectez-vous à [console.twilio.com](https://console.twilio.com)
2. Allez dans **Messaging > Try it out > Send a WhatsApp message**
3. Rejoignez le sandbox en envoyant le code d'activation depuis votre WhatsApp
4. Dans **Sandbox Settings**, renseignez les URLs suivantes :

| Champ | Valeur |
|-------|--------|
| **When a message comes in** | `https://<votre-domaine>/webhook/whatsapp` |
| **Status callback URL** | `https://<votre-domaine>/webhook/twilio/status` |

### Étape 2 — WhatsApp Business (production)

1. Demandez l'accès WhatsApp Business dans la console Twilio
2. Créez un **Messaging Service** dans **Messaging > Services**
3. Ajoutez le numéro WhatsApp Business approuvé comme sender
4. Utilisez `TWILIO_MESSAGING_SERVICE_SID` dans votre `.env`

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `TWILIO_ACCOUNT_SID` | Oui | Account SID Twilio |
| `TWILIO_AUTH_TOKEN` | Oui | Auth Token Twilio |
| `TWILIO_MESSAGING_SERVICE_SID` | Ou | SID du Messaging Service (recommandé) |
| `TWILIO_WHATSAPP_FROM` | Ou | Numéro WhatsApp direct (`whatsapp:+14155238886`) |
| `PUBLIC_BASE_URL` | Oui | URL HTTPS publique du déploiement |
| `TWILIO_STATUS_CALLBACK_URL` | Non | Override URL status callback |
| `TWILIO_ALLOW_MANUAL_SEND_WITHOUT_CONSENT` | Non | `true` pour tests admin sans opt-in |
| `MEDINDEX_API_URL` | Non | URL API MedIndex (base démo si absent) |
| `MEDINDEX_API_KEY` | Non | Clé API MedIndex |
| `BLINK_API_URL` | Non | URL API Blink Pharma |
| `BLINK_API_KEY` | Non | Clé API Blink Pharma |
| `SOBRUS_API_URL` | Non | URL API Sobrus |
| `SOBRUS_API_KEY` | Non | Clé API Sobrus |
| `MONITORING_TIMEOUT_MS` | Non | Timeout APIs monitoring (défaut: 10000) |
| `PORT` | Non | Port local (défaut: 3000) |

---

## Déploiement

### Option A — Railway / Render (recommandé pour la production)

Ces plateformes offrent un **filesystem persistant**, requis pour le stockage JSON.

**Railway :**
```bash
# Installer Railway CLI
npm i -g @railway/cli
railway login
railway init
railway up
```
Configurer les variables d'environnement dans le dashboard Railway.

**Render :**
- Créer un nouveau **Web Service** sur render.com
- Connecter le dépôt GitHub
- Build command : `npm install`
- Start command : `node index.js`
- Configurer les variables d'environnement dans le dashboard

### Option B — Vercel

> ⚠️ **Limitation importante** : Vercel utilise un filesystem éphémère. Les fichiers `data/*.json` sont réinitialisés à chaque cold start. Utilisez Vercel uniquement pour des tests ou pour valider le flux Twilio.

```bash
# Installer Vercel CLI
npm i -g vercel

# Déployer
vercel

# Configurer les variables d'environnement
vercel env add TWILIO_ACCOUNT_SID
vercel env add TWILIO_AUTH_TOKEN
# ... (répéter pour chaque variable)

# Redéployer avec les variables
vercel --prod
```

Pour la production sur Vercel avec persistance, ajoutez une base PostgreSQL (Neon.tech ou Supabase) et adaptez le layer `storage.js`.

---

## URLs Twilio à configurer

Après déploiement, configurez ces URLs dans la console Twilio :

| Endpoint | URL | Usage |
|----------|-----|-------|
| **Request URL** (principal) | `https://<domaine>/webhook/whatsapp` | Messages entrants WhatsApp |
| **Fallback URL** | `https://<domaine>/webhooks/twilio/whatsapp/fallback` | Fallback si Request URL échoue |
| **Status Callback** | `https://<domaine>/webhook/twilio/status` | Statut de livraison |

---

## Modules optionnels

### MedIndex

1. Obtenez une clé API auprès de MedIndex
2. Définissez `MEDINDEX_API_URL` et `MEDINDEX_API_KEY`
3. Créez un thème avec `module_type: medindex` depuis `/admin/themes`

Sans configuration, la base locale de démonstration est utilisée automatiquement.

### Interactions médicamenteuses

Aucune configuration API requise. Le module fonctionne avec la base locale intégrée.
Créez un thème avec `module_type: interactions` depuis `/admin/themes`.

### Monitoring Blink / Sobrus

1. Obtenez les credentials API de Blink Pharma ou Sobrus
2. Définissez les variables `BLINK_API_URL`, `BLINK_API_KEY` (et/ou `SOBRUS_*`)
3. Les pharmaciens peuvent configurer leur ID pharmacie via la page CRM de l'admin

Sans configuration, des données de démonstration sont utilisées.

---

## Administration

L'interface d'administration est accessible sur `/admin` :

| Page | URL | Description |
|------|-----|-------------|
| Dashboard | `/admin` | Vue d'ensemble, statut Twilio |
| Thèmes | `/admin/themes` | Créer/modifier les modules WhatsApp |
| Contenu | `/admin/content` | Q&A par thème (base de connaissances) |
| CRM | `/admin/crm` | Profils pharmaciens, statistiques |
| Templates | `/admin/templates` | Templates Twilio/Meta pour envoi sortant |
| Monitoring | `/admin/monitoring` | Statut Blink/Sobrus, alertes stock, ventes |

> ⚠️ **Sécurité** : L'admin n'a pas d'authentification HTTP par défaut. En production, protégez `/admin` avec un reverse proxy (Basic Auth Nginx) ou implémentez `ADMIN_SECRET`.

---

## Sécurité

Points à vérifier avant la mise en production :

1. **Validation de signature Twilio** : configurez la vérification de la signature X-Twilio-Signature sur le webhook principal (voir `twilio_service.js`)
2. **Protection de l'admin** : ajoutez une authentification HTTP Basic ou OAuth sur la route `/admin`
3. **HTTPS obligatoire** : ne jamais exposer le webhook en HTTP non chiffré
4. **Rotation des tokens** : changez `TWILIO_AUTH_TOKEN` régulièrement et en cas de fuite
5. **Consentement RGPD** : le consentement explicite est géré, vérifiez la politique de rétention des données de `data/message_logs.json`
6. **Stockage des données** : les fichiers `data/*.json` contiennent des numéros de téléphone — appliquez les droits d'accès appropriés au filesystem

---

## Commandes utiles

```bash
# Démarrage local
node index.js

# Vérifier la santé de l'API
curl http://localhost:3000/

# Tester le statut Twilio
curl http://localhost:3000/admin/api/twilio/status

# Tester MedIndex
curl "http://localhost:3000/admin/api/medindex/search?q=paracetamol"

# Tester le statut monitoring
curl http://localhost:3000/admin/api/monitoring/status
```
