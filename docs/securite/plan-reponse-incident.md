# Plan de réponse aux incidents de sécurité

Volet technique. Le volet juridique (qualification d'une violation de données, notifications) est
dans `docs/legal/procedure-violation-donnees.md` et démarre **en parallèle** dès qu'une donnée
personnelle peut être concernée.

## Rôles (à nommer avant la mise en production)

| Rôle                   | Responsabilité                          | Titulaire / suppléant |
| ---------------------- | --------------------------------------- | --------------------- |
| Responsable d'incident | décide, coordonne, tient la chronologie | [nom] / [nom]         |
| Technique              | investigation, confinement, correctif   | [nom] / [nom]         |
| Communication          | clients, autorité, message public       | [nom]                 |

Astreinte joignable : [téléphone]. Canal d'incident privé : [canal]. Ne jamais discuter d'un incident
en cours dans un canal partagé avec des tiers.

## Niveaux

- **Critique** : accès d'une entreprise aux données d'une autre, fuite de base ou de sauvegarde,
  compromission d'une clé ou d'un compte d'administration, bulletin falsifié vérifié comme authentique.
- **Élevé** : compte client compromis, vulnérabilité exploitable signalée, indisponibilité > 4 h
  pendant une période d'échéance (DIPE / CNPS).
- **Modéré** : tentative bloquée inhabituelle (vague de connexions, scans), indisponibilité courte.

## Étapes

1. **Détecter et ouvrir** : alerte (journal d'audit hors entreprise lu par `paiecam_ops`, échecs
   2FA, `/api/health`, signalement security.txt, client). Ouvrir une fiche horodatée.
2. **Préserver** : copie des journaux de l'hébergeur, du proxy et de `audit_log`, instantané de la
   base **avant** toute correction ; noter qui accède à quoi.
3. **Confiner** (selon le cas) :
   - comptes : supprimer les sessions (`delete from sessions where user_id = …`), forcer la
     réinitialisation du mot de passe, désactiver la 2FA compromise ;
   - toutes les sessions : changer `BETTER_AUTH_SECRET` et redémarrer (déconnecte tout le monde) ;
   - clés de chiffrement : ajouter une nouvelle clé en tête de `FIELD_ENCRYPTION_KEYS`, redémarrer,
     re-chiffrer (**script de re-chiffrement à écrire : pas encore disponible**), puis retirer l'ancienne clé (les documents signés restent vérifiables tant que la
     clé de signature est conservée) ;
   - accès base / S3 / SMTP : révoquer et renouveler les identifiants des rôles concernés ;
   - application : mise en maintenance (proxy) si la fuite est en cours.
4. **Éradiquer** : corriger la cause, ajouter le **test qui reproduit la faille** (multi-entreprises,
   architecture ou e2e), passer `pnpm verify`, déployer.
5. **Rétablir** : vérifier `/api/health`, un parcours de paie fictif complet, la surveillance
   renforcée pendant 7 jours ; restaurer depuis sauvegarde si des données ont été altérées
   (`docs/exploitation/sauvegardes.md`).
6. **Retour d'expérience** sous 5 jours ouvrés : chronologie, cause racine, ce qui a bien ou mal
   fonctionné, actions datées ; mise à jour de ce plan et de la revue ASVS.

## Exercices

Un exercice sur table par semestre (scénarios : clé de chiffrement divulguée dans un dépôt ; client
voyant les salariés d'un autre ; sauvegarde perdue).
