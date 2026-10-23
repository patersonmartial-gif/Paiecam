# Documents juridiques — PROJETS

> **À faire relire par un avocat camerounais avant toute utilisation.** Rédigés par l'équipe
> technique pour décrire fidèlement le fonctionnement réel du logiciel ; ils ne constituent pas un
> avis juridique. Les éléments entre crochets sont à compléter, les références de textes à vérifier.

| Document                                            | Public              | Fichier                          |
| --------------------------------------------------- | ------------------- | -------------------------------- |
| Mentions légales, politique de confidentialité, CGU | oui (pages du site) | `apps/web/src/content/legal.ts`  |
| Accord de traitement des données (annexe aux CGU)   | clients             | `accord-traitement-donnees.md`   |
| Registre des traitements                            | interne             | `registre-traitements.md`        |
| Procédure en cas de violation de données            | interne             | `procedure-violation-donnees.md` |

Questions à poser à l'avocat :

1. Obligations de la loi n° 2024/017 applicables à PaieCam (sous-traitant) et à ses clients
   (responsables) : déclaration ou autorisation préalable, désignation d'un délégué, délais de
   notification d'une violation, autorité compétente et date de mise en place effective.
2. Hébergement hors du Cameroun : est-il permis pour des données de paie, et à quelles conditions ?
3. Durées de conservation des bulletins, du livre de paie, des déclarations CNPS et fiscales et des
   pièces justificatives (Code du travail, CGI, réglementation CNPS, OHADA pour les pièces comptables).
4. Valeur probante d'un bulletin électronique signé et vérifiable en ligne ; remise au salarié par
   voie électronique : accord du salarié nécessaire ?
5. Limitation de responsabilité de l'éditeur en cas d'erreur de calcul imputable au référentiel.
