# Rotation des clés de chiffrement (FIELD_ENCRYPTION_KEYS)

À faire chaque année, et **immédiatement** si une clé a pu être exposée (voir le plan de réponse
aux incidents). `BETTER_AUTH_SECRET` (sessions, 2FA) et les clés `age` des sauvegardes suivent
leurs propres procédures.

## Ce que couvre la commande

| Élément                                          | Action                                                         |
| ------------------------------------------------ | -------------------------------------------------------------- |
| N° CNPS chiffré                                  | rechiffré avec la nouvelle clé                                 |
| Empreinte du n° CNPS (détection des doublons)    | recalculée                                                     |
| IBAN et numéro mobile money                      | rechiffrés                                                     |
| Fichiers PDF du stockage                         | rechiffrés (remplacement atomique ; S3 : conditionné à l'ETag) |
| Signatures des documents (vérification publique) | renouvelées **seulement si la signature actuelle est valide**  |
| Liens de téléchargement                          | aucun : ils expirent en 5 minutes                              |

La commande s'exécute avec le rôle `paiecam_rotation`, qui ne voit que ces colonnes chiffrées et
ne peut rien modifier d'autre. Elle est relançable et trace chaque exécution dans le journal
d'audit (compteurs uniquement).

## Procédure

1. Générer la nouvelle clé : `openssl rand -base64 32`, la ranger dans le gestionnaire de secrets.
2. La placer **en tête** du trousseau, l'ancienne restant derrière :
   `FIELD_ENCRYPTION_KEYS=v2:<nouvelle>,v1:<ancienne>`. Redémarrer l'application et le worker :
   toute nouvelle donnée est chiffrée avec v2, l'ancienne reste lisible.
3. Simulation, depuis l'image `worker` (elle contient les sources) :
   `ROTATION_DATABASE_URL=… pnpm --filter @paiecam/web rotate-keys`.
4. Application : `… rotate-keys --apply`. Code de sortie 2 = éléments à examiner (listés par
   identifiant). Un document signalé « signature actuelle invalide » a peut-être été falsifié :
   ouvrir un incident, ne pas le re-signer à la main.
5. Relancer `--apply` jusqu'à ce que tous les compteurs soient à 0 et la liste d'échecs vide.
6. Retirer l'ancienne clé du trousseau (`FIELD_ENCRYPTION_KEYS=v2:<nouvelle>`), redémarrer, vérifier
   un bulletin récent et un ancien (téléchargement et page de vérification).
7. Changer le mot de passe du rôle `paiecam_rotation`.

## Limites à connaître

- Entre les étapes 2 et 5, un salarié créé avec la nouvelle clé n'est pas comparé aux empreintes
  encore calculées avec l'ancienne : un doublon de n° CNPS ne serait pas détecté. Exécuter la
  rotation juste après le redémarrage, hors période de saisie.
- Les **sauvegardes** déjà faites restent chiffrées par l'ancienne clé applicative : conserver
  l'ancienne clé, hors ligne, aussi longtemps que ces sauvegardes (sinon elles deviennent
  illisibles). En cas de compromission, ces sauvegardes restent protégées par leur propre
  chiffrement `age`.
- Avec le versionnage S3, les **anciennes versions** des fichiers restent chiffrées par l'ancienne
  clé : après une compromission, purger les versions antérieures quand la politique de rétention
  le permet.
