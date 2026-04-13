# Flux utilisateurs — WhatsApp Pharma Bot

Ce document décrit les parcours conversationnels principaux du bot WhatsApp pour pharmaciens.

---

## 1. Premier contact et onboarding

```
Pharmacien envoie n'importe quel message
        ↓
[AWAITING_CONSENT]
Bot : message de bienvenue + conditions générales
      "Pour activer le service, répondez uniquement par OUI."
        ↓
Pharmacien répond "OUI"
        ↓
Consentement explicite enregistré (consents.json)
        ↓
[ONBOARDING_NAME]
Bot : "Bienvenue! Quel est votre prénom et nom ? (ou PASSER)"
        ↓
Pharmacien répond (ex: "Mohammed Benali") ou "PASSER"
CRM mis à jour (pharmacists.json)
        ↓
[ONBOARDING_PHARMACY]
Bot : "Quel est le nom de votre pharmacie ? (ou PASSER)"
        ↓
Pharmacien répond (ex: "Pharmacie Al Amal") ou "PASSER"
        ↓
[ONBOARDING_CITY]
Bot : "Dans quelle ville exercez-vous ? (ou PASSER)"
        ↓
Pharmacien répond (ex: "Casablanca") ou "PASSER"
        ↓
[ONBOARDING_SOFTWARE]
Bot : choix logiciel — 1. Blink Pharma / 2. Sobrus / 3. Autre / 4. Passer
        ↓
Pharmacien répond
CRM complété (onboarding_completed: true)
        ↓
[MAIN_MENU]
Bot : "Profil enregistré. [menu principal avec les thèmes actifs]"
```

**Commandes pendant l'onboarding :** `PASSER` / numéro 4 pour sauter chaque étape.

---

## 2. Navigation dans le menu principal

```
[MAIN_MENU]
Bot affiche les thèmes actifs numérotés :
  1. Feuille de soins électronique
  2. Nouveautés médicaments
  3. MedIndex - Recherche médicaments
  4. Interactions médicamenteuses
  5. Monitoring (Blink/Sobrus)

Pharmacien envoie "3" (ou le payload "theme_medindex")
        ↓
[THEME_MENU] pour le thème sélectionné
Bot : titre + intro_message + options :
  1. [Action principale selon module_type]
  2. S'abonner aux mises à jour (si enabled)
  3. Retour au menu

Commandes globales (toujours actives) :
  MENU  → retour au menu principal
  RETOUR → retour au menu du thème courant (ou menu principal)
  STOP  → révocation consentement + reset complet
```

---

## 3. Module — Base de connaissances (knowledge_base)

```
[THEME_MENU] → Pharmacien choisit "1. Poser ma question"
        ↓
[AWAITING_FREE_QUESTION]
Bot : "Posez votre question sur [thème]..."

Pharmacien envoie : "comment transmettre une FSE refusée"
        ↓
Matching sur les topics du thème (keywords + titre)
        ↓
Si match trouvé :
  Bot : réponse du topic + menu du thème
Si pas de match :
  Bot : "Votre question a bien été reçue. Elle nécessite une analyse plus spécifique."
        + menu du thème

Pharmacien peut poser une autre question, ou envoyer RETOUR.
```

---

## 4. Module — MedIndex (medindex)

```
[THEME_MENU] → Pharmacien choisit "1. Rechercher un médicament (MedIndex)"
        ↓
[AWAITING_MEDINDEX_QUERY]
Bot : "Tapez le nom du médicament (nom commercial ou DCI)"

Pharmacien envoie : "Metformine 850"
        ↓
Appel API MedIndex (ou base locale si non configurée)
        ↓
Bot répond :
  Résultats MedIndex pour "Metformine 850" :

  1. Metformine 850mg PHARMA5
     DCI: Metformine | Comprimé 850mg
     [OK] | 18 MAD | Lab: PHARMA5
  
  2. ...

  Autre recherche : tapez le nom. Retour menu : RETOUR

L'état reste AWAITING_MEDINDEX_QUERY → pharmacien peut enchaîner les recherches.
RETOUR → retour au menu du thème.
```

---

## 5. Module — Interactions médicamenteuses (interactions)

```
[THEME_MENU] → Pharmacien choisit "1. Analyser des interactions"
        ↓
[AWAITING_INTERACTION_DRUGS]
Bot : "Envoyez les médicaments séparés par '+' ou ','"
       Exemple : Métformine + Ibuprofène

Pharmacien envoie : "Warfarine + Aspirine + Paracétamol"
        ↓
Parsing en liste : ["Warfarine", "Aspirine", "Paracétamol"]
Analyse croisée de toutes les paires
        ↓
Bot répond :
  Analyse d'interactions pour :
    - Warfarine
    - Aspirine
    - Paracétamol

  Bilan : 1 interaction ROUGE

  [ROUGE] EVITER
    Warfarine + Aspirine
    Risque hémorragique majeur. Association à éviter sauf avis spécialisé.

  [ORANGE] Surveiller
    Warfarine + Paracétamol
    Paracétamol à doses élevées potentialise l'anticoagulation. Surveiller l'INR.

  Sources : base interne...

  Nouvelle analyse : envoyez les noms. Retour : RETOUR

L'état reste AWAITING_INTERACTION_DRUGS → analyses enchaînables.
```

---

## 6. Module — Monitoring Blink / Sobrus (monitoring)

```
[THEME_MENU] → Pharmacien choisit "1. Consulter mon monitoring"
        ↓
[AWAITING_MONITORING_CHOICE]
Bot : "Module Monitoring - Blink Pharma
  1. Alertes de stock (ruptures / sous seuil)
  2. Résumé des ventes
  3. Retour au menu"

Pharmacien envoie "1" ou "STOCK"
        ↓
Appel connecteur Blink/Sobrus (selon logiciel enregistré en CRM)
        ↓
Bot répond :
  Blink Pharma - Alertes stock (2) :

  [RUPTURE] Ibuprofène 400mg COOPER
    Stock: 0 | Seuil min: 10

  [SOUS SEUIL] Amoxicilline 1g SOTHEMA
    Stock: 12 | Seuil min: 15

  Retour menu : RETOUR | Actualiser : STOCK

Commandes rapides : STOCK | VENTES | RETOUR
```

---

## 7. Flux de désabonnement (STOP)

```
Pharmacien envoie "STOP" (depuis n'importe quel état)
        ↓
- Révocation du consentement (suppression de consents.json)
- Suppression de tous les abonnements
- Reset de l'état utilisateur → AWAITING_CONSENT
        ↓
Bot : "Votre accès est désactivé. Répondez OUI pour réactiver."
```

---

## 8. Flux d'authentification (modules sécurisés)

```
Pharmacien sélectionne un thème avec requires_auth: true
et n'est pas encore authentifié
        ↓
[AWAITING_AUTH]
Bot : menu de connexion :
  "1. Recevoir mon lien de connexion
   2. Retour au menu"

Pharmacien choisit "1"
        ↓
Bot envoie le lien de connexion sécurisé :
  https://portail-pharmacie.example.com/connexion?module=acces-stock

Pharmacien se connecte sur le portail, revient sur WhatsApp
        ↓
Pharmacien envoie "AUTH OK"
        ↓
Statut authentifié mis à jour (users.json)
Bot : "Authentification prise en compte." + menu du thème
```

---

## 9. Flux d'abonnement aux mises à jour

```
Dans le menu d'un thème avec allow_subscription: true :
Pharmacien choisit "2. Recevoir les mises à jour de ce thème"
        ↓
Si déjà abonné :
  Bot : "Vous recevez déjà les mises à jour de ce thème."
Si pas abonné :
  Abonnement enregistré (subscriptions.json)
  Bot : "Votre abonnement aux mises à jour a bien été activé."
        ↓
→ L'admin peut envoyer des messages groupés depuis /admin/templates
```

---

## États de la machine conversationnelle

| État | Description |
|------|-------------|
| `awaiting_consent` | Attente du OUI initial |
| `onboarding_name` | Collecte du nom |
| `onboarding_pharmacy` | Collecte du nom de la pharmacie |
| `onboarding_city` | Collecte de la ville |
| `onboarding_software` | Collecte du logiciel |
| `main_menu` | Menu principal |
| `theme_menu` | Menu d'un thème |
| `awaiting_free_question` | Question libre (knowledge_base) |
| `awaiting_medindex_query` | Recherche MedIndex |
| `awaiting_interaction_drugs` | Analyse interactions |
| `awaiting_monitoring_choice` | Menu monitoring |
| `awaiting_auth` | Attente d'authentification |

---

## Commandes globales (valides dans tous les états)

| Commande | Action |
|----------|--------|
| `OUI` | Active le service (état: awaiting_consent) |
| `STOP` | Désactive et réinitialise tout |
| `MENU` | Retour au menu principal |
| `RETOUR` | Retour au menu précédent |
| `AUTH OK` | Valider l'authentification |
| `PASSER` | Passer une étape d'onboarding |
| `STOCK` | Raccourci vers les alertes stock (état: awaiting_monitoring_choice) |
| `VENTES` | Raccourci vers les ventes (état: awaiting_monitoring_choice) |
