# Accord de traitement des données (projet)

> **Projet à faire relire par un avocat camerounais.** Annexe aux conditions générales d'utilisation.

Entre **le client** (l'employeur, responsable du traitement) et **[éditeur de PaieCam]**
(sous-traitant).

## 1. Objet et durée

Le sous-traitant traite, pour le compte du client, les données personnelles des salariés
nécessaires à l'établissement de la paie et des déclarations, pendant la durée de l'abonnement et
la période de restitution prévue à l'article 9.

## 2. Nature des traitements

Hébergement, calcul des bulletins, génération des documents PDF (bulletins, attestations,
déclarations), stockage chiffré, envoi d'e-mails de service, sauvegarde. Aucun autre usage : ni
revente, ni publicité, ni profilage, ni entraînement de modèles d'intelligence artificielle.

## 3. Catégories de données et de personnes

Salariés (et anciens salariés) du client : identité, date de naissance, matricule, numéros CNPS et
fiscal, emploi et classification, dates de contrat, rémunération et éléments variables, absences,
coordonnées bancaires, bulletins et déclarations. Utilisateurs désignés par le client : nom,
e-mail, journal de connexion.

## 4. Instructions

Le sous-traitant n'agit que sur instruction documentée du client ; l'utilisation du logiciel (saisie,
calcul, validation, export, suppression) vaut instruction. Il informe le client si une instruction
lui paraît contraire à la loi.

## 5. Confidentialité et personnel

Les personnes du sous-traitant ayant accès aux systèmes sont tenues au secret, formées, et en
nombre limité. Aucun accès aux données d'un client n'a lieu hors demande d'assistance de ce client
ou incident de sécurité, et chaque accès est journalisé.

## 6. Sécurité (mesures décrites dans `docs/securite/revue-owasp-asvs-l2.md`)

- Cloisonnement de chaque entreprise au niveau de la base (sécurité au niveau des lignes forcée).
- Chiffrement des échanges (TLS) ; chiffrement applicatif AES-256-GCM des données sensibles et des
  documents ; clés gérées hors du code et renouvelables.
- Mots de passe hachés (Argon2id), double authentification obligatoire pour les rôles de gestion,
  verrouillage progressif après échecs, sessions limitées à 8 heures.
- Journal d'audit des actions sensibles ; journaux techniques sans données personnelles.
- Sauvegardes chiffrées quotidiennes, copiées hors site, restaurations testées.

## 7. Sous-traitants ultérieurs

Liste annexée : hébergement [nom, pays], stockage objet [nom, pays], e-mail [nom, pays]. Le
sous-traitant informe le client de tout changement au moins [30] jours à l'avance ; le client peut
s'y opposer et résilier sans frais. Les mêmes obligations sont imposées aux sous-traitants ultérieurs.

## 8. Assistance

Le sous-traitant aide le client à répondre aux demandes des personnes (export des données d'un
salarié disponible dans le logiciel), à réaliser une analyse d'impact si nécessaire, et lui notifie
**toute violation de données le concernant sans délai indu et au plus tard [48] heures** après en
avoir eu connaissance, avec les informations disponibles (nature, données et personnes concernées,
conséquences probables, mesures prises).

## 9. Fin du contrat

Le client peut exporter ses données pendant [30] jours après la fin de l'abonnement. Ensuite, le
sous-traitant les supprime, y compris des sauvegardes au terme de leur rotation ([durée]), sauf
conservation imposée par la loi, et en atteste par écrit sur demande.

## 10. Audit

Le sous-traitant met à disposition les informations nécessaires pour démontrer le respect du
présent accord (rapport de tests d'intrusion, synthèse de la revue de sécurité) et permet un audit
sur pièces une fois par an, ou après un incident.

## 11. Localisation et transferts

Données hébergées en [pays]. [Garanties et formalités à préciser selon la loi n° 2024/017.]
