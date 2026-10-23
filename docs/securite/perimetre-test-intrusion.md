# Test d'intrusion — périmètre et règles d'engagement (à transmettre au prestataire)

## Objectif

Vérifier avant la mise en production qu'aucune entreprise cliente ne peut lire ou modifier les
données d'une autre, que les données de paie ne peuvent pas être exfiltrées ni falsifiées, et que
les comptes résistent aux attaques courantes. Référentiel : OWASP ASVS 4.0 niveau 2 (synthèse de
notre revue dans `revue-owasp-asvs-l2.md`).

## Périmètre

- Application web de préproduction : [https://preprod…] (même image Docker que la production,
  **données fictives uniquement**).
- Comptes fournis : deux entreprises fictives, chacune avec un propriétaire, un gestionnaire de paie
  et un comptable (lecture seule), 2FA activée ; un compte sans entreprise.
- Points d'intérêt prioritaires :
  1. Cloisonnement entre entreprises (IDOR sur salariés, bulletins, documents, déclarations,
     exports, invitations ; manipulation du cookie d'entreprise active).
  2. Élévation de rôle (comptable → gestionnaire, membre → propriétaire).
  3. Authentification : 2FA, limites de tentatives, verrouillage, énumération de comptes (y compris
     par temps de réponse), réinitialisation, sessions.
  4. Documents : liens de téléchargement signés, page publique de vérification, falsification d'un
     bulletin PDF accepté comme authentique.
  5. Import Excel (fichiers piégés, formules, archives volumineuses) et exports (injection de
     formules).
  6. Server Actions : CSRF, origine, validation des entrées, taille des requêtes.
  7. En-têtes, CSP, cookies, configuration TLS du proxy.
- Revue de configuration (sur pièces) : rôles PostgreSQL et politiques RLS, gestion des secrets,
  sauvegardes.

## Hors périmètre

Production ; déni de service et tests de charge ; ingénierie sociale ; infrastructure de
l'hébergeur et des fournisseurs (S3, e-mail) au-delà de notre configuration.

## Règles

- Fenêtre : [dates], horaires [ ] ; IP source du prestataire communiquées à l'avance.
- Arrêt immédiat et appel de [contact] en cas de découverte d'une faille critique ou de données
  qui sembleraient réelles.
- Aucune donnée extraite conservée après la remise du rapport.

## Livrables attendus

Rapport avec, pour chaque constat : sévérité (CVSS), preuve, impact, correction recommandée ;
contre-test gratuit après correction ; synthèse non technique communicable aux clients.
