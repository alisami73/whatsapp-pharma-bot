'use strict';

const EMBEDDED_FAQ_FALLBACKS = {
  fse: `=== Source: fse_faq.embedded.md ===
# FAQ Pharmacien — Feuille de Soins Électronique (FSE) — CNSS

### C'est quoi la FSE ?
La FSE est une feuille de soins électronique destinée à remplacer progressivement une gestion papier longue et administrative.
Le principe est de numériser la feuille de soins, de limiter les manipulations manuelles et de faciliter la transmission des informations.

### La FSE est-elle déjà obligatoire ?
Non. La FSE n'est pas encore obligatoire. Elle est actuellement en phase pilote.
Seules certaines pharmacies sélectionnées participent au test.
Tant que votre pharmacie n'a pas reçu de communication officielle, vous continuez à travailler comme avant.

### Comment cela va fonctionner ?
1. Le médecin crée une feuille de soins électronique.
2. Un QR code ou un code unique est généré.
3. Le patient vient à la pharmacie avec ce code.
4. La pharmacie scanne le code.
5. Les médicaments apparaissent automatiquement dans le logiciel.

### Que fait le pharmacien ?
Le pharmacien garde le même rôle :
- vérifier l'ordonnance,
- délivrer les médicaments,
- conseiller le patient.
La principale différence est une réduction du papier.

### Est-ce qu'il faudra un nouveau logiciel ?
Non. Le système doit être connecté directement au logiciel de gestion officinale existant.

### Faut-il un matériel spécifique ?
Dans la plupart des cas, les scanners actuels peuvent lire le QR code.
Sinon, le code peut être saisi manuellement.

### Que se passe-t-il après la délivrance ?
Après la délivrance :
- les informations sont transmises automatiquement à la CNSS,
- la délivrance est tracée numériquement.

### Quels sont les avantages ?
La FSE vise à apporter :
- moins d'administratif,
- moins d'erreurs liées au papier,
- plus de temps pour le patient,
- un processus plus rapide.
`,

  cndp: `=== Source: cndp_faq.embedded.md ===
# FAQ Conformité CNDP — Loi n° 09-08

### Présentation
Ce guide explique aux pharmaciens comment se mettre en conformité avec la Loi n° 09-08 relative à la protection des données personnelles et avec les exigences de la CNDP.

### Pourquoi cette démarche est obligatoire ?
Les pharmacies traitent quotidiennement des données personnelles sensibles :
- identité des clients,
- numéro de téléphone,
- ordonnances,
- historique d'achats,
- vidéosurveillance si elle existe,
- données du personnel.
Ces traitements doivent être déclarés et encadrés conformément à la Loi 09-08.

### Quelles sont les étapes de mise en conformité ?
1. Demander Mon Identité Numérique.
2. Aller sur https://sante.cndp.ma.
3. Créer ou activer votre espace professionnel de santé.
4. Faire l'authentification numérique.
5. Autoriser le partage des données.
6. Remplir le formulaire CNDP.
7. Imprimer le formulaire.
8. Signer et cacheter.
9. Envoyer le dossier par e-mail.
10. Attendre le suivi de la CNDP.

### Combien de pages contient le formulaire CNDP ?
Le formulaire CNDP comporte 8 pages.

### À quelle adresse faut-il envoyer le dossier ?
Le dossier doit être envoyé à : conf-secteur-sante@cndp.ma

### Quel portail faut-il utiliser ?
Le portail à utiliser est : https://sante.cndp.ma

### Est-ce obligatoire pour toutes les pharmacies ?
Oui, dès lors que la pharmacie traite des données personnelles.

### Et si je n'ai pas de caméras ?
Vous devez quand même déclarer les autres traitements de données.

### Quels documents préparer ?
- CIN électronique,
- téléphone compatible identité numérique,
- cachet de la pharmacie,
- adresse exacte de la pharmacie,
- informations sur les caméras si elles existent,
- adresse e-mail professionnelle.
`,

  cnss: `=== Source: cnss_faq.embedded.md ===
# FAQ CNSS — Base de connaissances pour pharmaciens

### Comment affilier un salarié à la CNSS ?
L'affiliation se fait via Damancom ou en agence CNSS.
L'employeur doit fournir le CIN, le contrat de travail et déclarer le salarié dans les 30 jours suivant l'embauche.

### Quel est le délai d'immatriculation à la CNSS ?
L'immatriculation doit être effectuée dans les 30 jours suivant le début de l'activité ou de l'embauche.

### Quel est le taux de cotisation CNSS ?
Le taux global mentionné dans la base est de 26,96%, réparti entre employeur et salarié.

### Quand faut-il payer les cotisations CNSS ?
Les cotisations doivent être déclarées et payées avant le 10 du mois suivant.

### Qu'est-ce que l'AMO CNSS ?
L'AMO couvre les salariés et leurs ayants droit pour les soins médicaux : consultations, médicaments, hospitalisation et analyses.

### Quels médicaments sont remboursés par l'AMO CNSS ?
Les médicaments remboursables sont ceux inscrits sur la liste nationale de remboursement.

### Quel est le délai de remboursement AMO ?
Le délai moyen mentionné dans la base est de 30 à 45 jours après dépôt du dossier complet.

### Comment soumettre une feuille de soins CNSS ?
La feuille de soins doit être remplie par le médecin et la pharmacie, signée par l'assuré, puis déposée avec les pièces justificatives dans le délai prévu.

### Qu'est-ce que Damancom ?
Damancom est le portail en ligne de la CNSS pour les employeurs. Il permet notamment de déclarer et payer les cotisations et de gérer les affiliations.
`,
};

function normalizeScope(scope) {
  return String(scope || '').trim().toLowerCase();
}

function getEmbeddedFaqFallback(scope) {
  const normalizedScope = normalizeScope(scope);

  if (normalizedScope === 'conformites' || normalizedScope === 'compliance' || normalizedScope === 'regulations') {
    return [EMBEDDED_FAQ_FALLBACKS.cndp, EMBEDDED_FAQ_FALLBACKS.cnss].join('\n\n');
  }

  return EMBEDDED_FAQ_FALLBACKS[normalizedScope] || '';
}

module.exports = {
  getEmbeddedFaqFallback,
};
