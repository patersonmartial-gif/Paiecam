# PaieCam sur un PC Windows (installation locale)

PaieCam s'installe sur **un seul PC Windows** : la base de données, l'application et les
sauvegardes restent sur ce PC. On l'utilise dans le navigateur de ce PC, à l'adresse
http://localhost:3000. Rien n'est accessible depuis le réseau ni depuis internet.

## Avant d'installer

- Windows 10 ou 11, 64 bits ; 4 Go de mémoire ; 2 Go d'espace disque libre.
- Un compte Windows **administrateur** pour l'installation.
- **Recommandé fortement** : chiffrement du disque (BitLocker), session Windows protégée par un
  mot de passe et verrouillée en cas d'absence. Les données de paie sont chiffrées par PaieCam,
  mais un PC volé et ouvert donne accès à l'application.
- Une **clé USB ou un disque externe** dédié aux sauvegardes.

## Installer

1. Lancer `PaieCam-Setup-<version>.exe` et suivre l'assistant (1 à 2 minutes).
2. À la fin, le **kit de récupération** s'ouvre : **l'imprimer** (ou le copier sur la clé USB),
   le ranger en lieu sûr hors du bureau, puis **supprimer le fichier du PC**
   (`C:\ProgramData\PaieCam\KIT-DE-RECUPERATION.txt`). C'est la seule copie de la clé qui
   permet de relire les sauvegardes.
3. PaieCam s'ouvre dans le navigateur : créer le compte du propriétaire, l'entreprise, puis
   activer la double authentification (application d'authentification sur téléphone).

## Au quotidien

- Icône **PaieCam** sur le bureau. Les services démarrent avec Windows.
- Les autres utilisateurs (comptable…) sont invités depuis Paramètres > Équipe : sans e-mail
  configuré, le **lien d'invitation s'affiche à l'écran**, à leur transmettre ; ils l'ouvrent
  sur ce même PC.
- Les échéances CNPS et DGI sont rappelées dans l'application (pas d'e-mail).

## Sauvegardes

- Automatiques chaque jour à 12 h 30 (et au démarrage du PC si la dernière date de plus de 20 h),
  dans `C:\ProgramData\PaieCam\sauvegardes`. Les 30 dernières sont conservées.
- Chaque sauvegarde est **un fichier chiffré** : base, documents et clés de l'installation.
  Sans le kit de récupération, il est illisible.
- **Copier chaque semaine** le dernier fichier `.sauvegarde` sur la clé USB, rangée hors du
  bureau. Menu Démarrer > PaieCam > _Dossier des sauvegardes_. Si aucune sauvegarde n'a été
  faite depuis 3 jours, PaieCam l'affiche en haut de chaque page.
- _Sauvegarder maintenant_ : menu Démarrer > PaieCam.

## Restaurer (PC en panne, remplacé ou erreur grave)

1. Installer PaieCam sur le PC (neuf ou réparé), **sans** créer de compte.
2. Copier le fichier `.sauvegarde` depuis la clé USB.
3. Menu Démarrer > PaieCam > _Restaurer une sauvegarde_ : choisir le fichier, taper
   `RESTAURER`, puis saisir la clé du kit de récupération.
4. **Imprimer aussi le nouveau kit de récupération** créé par cette installation (étape 2 de
   « Installer ») : les sauvegardes suivantes utiliseront cette nouvelle clé. Garder l'ancien
   kit tant que les anciennes sauvegardes sont conservées.
5. Se connecter avec les comptes habituels. Les documents présents avant la restauration sont
   mis de côté (`donnees\documents-avant-restauration-…`), jamais effacés.

## Mot de passe oublié, téléphone perdu

Menu Démarrer > PaieCam > _Dépanner un compte_ (administrateur Windows) :

- _Mot de passe oublié_ : un mot de passe provisoire s'affiche, à remettre en main propre ;
- _Téléphone perdu_ : la double authentification est retirée et sera redemandée à la
  prochaine connexion.

Chaque dépannage est inscrit dans le journal de sécurité.

## Mettre à jour

Lancer le nouvel installateur : il arrête PaieCam, **fait une sauvegarde complète**, installe
la nouvelle version, applique les évolutions de la base et le référentiel de paie livré avec
la version (les règles déjà validées par l'expert-comptable ne sont jamais écrasées).

## Désinstaller

Panneau de configuration > Programmes. Les services sont retirés ; **les données et les
sauvegardes sont conservées** dans `C:\ProgramData\PaieCam` (obligations de conservation de la
paie). Les supprimer à la main seulement après le délai légal, et après une dernière sauvegarde.

## Pour le technicien

| Élément                                          | Emplacement                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Programmes (Node.js, PostgreSQL 16, application) | `C:\Program Files\PaieCam`                                                                            |
| Données, configuration, sauvegardes, journaux    | `C:\ProgramData\PaieCam` (Administrateurs, SYSTEM et Service réseau uniquement)                       |
| Services                                         | `PaieCam-Base` (PostgreSQL, 127.0.0.1:5433), `PaieCam-Web` (127.0.0.1:3000), `PaieCam-Worker`         |
| Compte des services                              | `NT AUTHORITY\NetworkService` (aucun droit d'administration)                                          |
| Outil d'administration                           | `C:\Program Files\PaieCam\node\node.exe outils\admin.mjs <commande> --dossier C:\ProgramData\PaieCam` |

L'installateur est construit et **essayé sur Windows** par `.github/workflows/windows-installer.yml`
(installation silencieuse, services, réponse de l'application, première sauvegarde, droits,
écoute locale, désinstallation sans perte de données).
