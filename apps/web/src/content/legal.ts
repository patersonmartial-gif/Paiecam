/**
 * Textes juridiques publics — PROJETS à faire relire par un avocat camerounais avant toute mise en
 * ligne. Les éléments entre crochets sont à compléter ; les références de textes sont à vérifier.
 * Rédigés en français (langue de référence) ; la version anglaise sera établie après relecture.
 */
export interface LegalSection {
  title: string;
  paragraphs: string[];
}
export interface LegalDocument {
  slug: "mentions-legales" | "confidentialite" | "conditions";
  title: string;
  version: string;
  sections: LegalSection[];
}

const VERSION = "projet 0.1 du 23 octobre 2026";

export const legalDocuments: LegalDocument[] = [
  {
    slug: "mentions-legales",
    title: "Mentions légales",
    version: VERSION,
    sections: [
      {
        title: "Éditeur",
        paragraphs: [
          "Le service PaieCam est édité par [raison sociale], [forme juridique] au capital de [montant] FCFA, immatriculée au RCCM sous le n° [n° RCCM], NIU [NIU], dont le siège est situé [adresse], Cameroun.",
          "Directeur de la publication : [nom et qualité].",
          "Contact : [adresse e-mail de contact] — [téléphone].",
        ],
      },
      {
        title: "Hébergement",
        paragraphs: [
          "Le service est hébergé par [nom de l'hébergeur], [adresse], [pays]. Les données sont stockées dans [pays / région du centre de données].",
          "Si les données sont hébergées hors du Cameroun, les conditions de ce transfert sont précisées dans la politique de confidentialité.",
        ],
      },
      {
        title: "Propriété intellectuelle",
        paragraphs: [
          "Le logiciel, les textes et éléments graphiques du service sont la propriété de l'éditeur. Les données saisies par les clients restent leur propriété.",
        ],
      },
      {
        title: "Signalement de vulnérabilité",
        paragraphs: [
          "Les failles de sécurité peuvent être signalées de façon confidentielle à l'adresse indiquée dans le fichier /.well-known/security.txt. Merci de ne pas accéder aux données d'autrui ni de perturber le service.",
        ],
      },
    ],
  },
  {
    slug: "confidentialite",
    title: "Politique de confidentialité",
    version: VERSION,
    sections: [
      {
        title: "Qui est responsable de vos données",
        paragraphs: [
          "Pour les données des salariés saisies par une entreprise cliente (identité, contrat, salaire, numéros CNPS et fiscal, coordonnées bancaires, bulletins, déclarations), l'entreprise cliente est responsable du traitement ; PaieCam agit comme sous-traitant, sur ses instructions, dans le cadre de l'accord de traitement des données annexé aux conditions d'utilisation.",
          "Pour les données des utilisateurs du service (nom, adresse e-mail, journal de connexion), l'éditeur de PaieCam est responsable du traitement.",
          "Cadre légal visé : loi n° 2024/017 du 23 décembre 2024 relative à la protection des données à caractère personnel au Cameroun, loi n° 2010/012 du 21 décembre 2010 relative à la cybersécurité et à la cybercriminalité, et Code du travail (loi n° 92/007 du 14 août 1992) [références et obligations déclaratives à vérifier par l'avocat].",
        ],
      },
      {
        title: "Finalités et bases légales",
        paragraphs: [
          "Établir les bulletins de paie, les déclarations sociales et fiscales et les documents de fin de contrat : exécution du contrat de travail et obligations légales de l'employeur.",
          "Gérer les comptes utilisateurs et sécuriser le service (authentification, double facteur, prévention des connexions frauduleuses, journal d'audit) : exécution du contrat d'abonnement et intérêt légitime de sécurité.",
          "Envoyer les e-mails de service (invitations, rappels d'échéances) : exécution du contrat d'abonnement.",
          "Aucune donnée n'est vendue, ni utilisée à des fins publicitaires, ni pour entraîner des modèles d'intelligence artificielle.",
        ],
      },
      {
        title: "Données traitées",
        paragraphs: [
          "Utilisateurs : nom, adresse e-mail, mot de passe (stocké uniquement sous forme d'empreinte Argon2id), secret de double authentification (chiffré), adresse IP et date des connexions.",
          "Salariés : nom, prénoms, date de naissance, matricule, numéros CNPS et fiscal, emploi, catégorie, dates d'embauche et de sortie, salaire et éléments variables de paie, coordonnées bancaires (chiffrées, affichées masquées), bulletins et déclarations.",
          "Les données les plus sensibles (coordonnées bancaires, documents) sont chiffrées dans la base et dans le stockage, avec des clés distinctes des sauvegardes.",
        ],
      },
      {
        title: "Destinataires et sous-traitants",
        paragraphs: [
          "Au sein de l'entreprise cliente : uniquement les utilisateurs qu'elle a invités, selon leur rôle (propriétaire, gestionnaire de paie, comptable en lecture seule…). Les données d'une entreprise ne sont jamais visibles par une autre entreprise.",
          "Sous-traitants de PaieCam : hébergement et stockage [nom, pays], envoi d'e-mails [nom, pays]. La liste à jour est communiquée sur demande et toute modification est notifiée aux clients.",
          "Vérification des mots de passe compromis : seuls les 5 premiers caractères de l'empreinte SHA-1 du mot de passe sont envoyés au service Have I Been Pwned ; le mot de passe n'est jamais transmis.",
          "Les déclarations sont générées pour l'employeur, qui les dépose lui-même auprès de la CNPS et de l'administration fiscale.",
        ],
      },
      {
        title: "Transferts hors du Cameroun",
        paragraphs: [
          "[À compléter selon l'hébergeur retenu : pays de stockage, garanties contractuelles, autorisations ou formalités préalables requises par la loi camerounaise.]",
        ],
      },
      {
        title: "Durées de conservation",
        paragraphs: [
          "Sessions de connexion : 8 heures au plus.",
          "Bulletins, livre de paie et déclarations : pendant la durée de conservation imposée à l'employeur par le Code du travail, le Code général des impôts et la réglementation CNPS [durées à confirmer], puis suppression ou anonymisation.",
          "Données de compte : pendant l'abonnement, puis [durée] après sa fin pour permettre la restitution des données ; journal de sécurité : [durée].",
          "Sauvegardes chiffrées : effacement au terme de leur cycle de rotation [durée].",
        ],
      },
      {
        title: "Vos droits",
        paragraphs: [
          "Vous disposez d'un droit d'accès, de rectification, d'opposition pour motif légitime et d'effacement dans les limites des obligations légales de conservation.",
          "Salariés : adressez votre demande à votre employeur, qui peut exporter depuis PaieCam l'ensemble de vos données dans un format lisible. Vous pouvez aussi écrire à [adresse e-mail de contact] ; nous transmettrons à votre employeur.",
          "Utilisateurs : écrivez à [adresse e-mail de contact]. Vous pouvez également saisir l'autorité de protection des données compétente [nom de l'autorité à préciser].",
        ],
      },
      {
        title: "Sécurité et cookies",
        paragraphs: [
          "Mesures principales : chiffrement des échanges (HTTPS), chiffrement des données sensibles, cloisonnement des entreprises dans la base de données, double authentification, journal d'audit, sauvegardes chiffrées testées régulièrement.",
          "Le service n'utilise que des cookies strictement nécessaires : session de connexion, entreprise active et langue choisie. Aucun cookie publicitaire ni de mesure d'audience.",
          "En cas de violation de données susceptible d'engendrer un risque pour les personnes, PaieCam en informe les entreprises clientes concernées sans délai indu, conformément à l'accord de traitement.",
        ],
      },
    ],
  },
  {
    slug: "conditions",
    title: "Conditions générales d'utilisation",
    version: VERSION,
    sections: [
      {
        title: "Objet",
        paragraphs: [
          "Les présentes conditions régissent l'utilisation du service PaieCam, logiciel en ligne d'aide à l'établissement de la paie et des déclarations sociales et fiscales des entreprises situées au Cameroun.",
        ],
      },
      {
        title: "Rôle du service et responsabilité de l'employeur",
        paragraphs: [
          "PaieCam calcule les bulletins à partir des données saisies par le client et d'un référentiel de taux, plafonds et barèmes validé par un expert-comptable. Le client reste seul responsable de l'exactitude des données saisies, de la validation de chaque mois de paie, du paiement des salaires et du dépôt des déclarations dans les délais.",
          "Un mois de paie calculé avec un référentiel non encore validé est signalé « provisoire » et ne peut pas être validé définitivement.",
          "[Clause de limitation de responsabilité et garanties à rédiger par l'avocat.]",
        ],
      },
      {
        title: "Compte et sécurité",
        paragraphs: [
          "Chaque utilisateur dispose d'un compte personnel. La double authentification est obligatoire pour le propriétaire et le gestionnaire de paie, et recommandée pour tous. L'utilisateur protège ses identifiants et signale sans délai toute utilisation non autorisée.",
          "Le propriétaire du compte entreprise gère les invitations et les rôles des utilisateurs qu'il autorise.",
        ],
      },
      {
        title: "Données du client",
        paragraphs: [
          "Le client reste propriétaire de ses données. PaieCam les traite en qualité de sous-traitant selon l'accord de traitement des données (annexe).",
          "En fin d'abonnement, le client peut exporter ses données pendant [durée] ; elles sont ensuite supprimées, sous réserve des obligations légales de conservation [à préciser].",
          "Il est interdit de saisir des données sans lien avec la gestion de la paie, ou des données de personnes qui ne sont pas salariées du client.",
        ],
      },
      {
        title: "Disponibilité, prix, résiliation",
        paragraphs: [
          "[Niveau de service, maintenance, tarifs et modalités de paiement, durée et résiliation : à compléter.]",
        ],
      },
      {
        title: "Droit applicable",
        paragraphs: [
          "Les présentes conditions sont soumises au droit camerounais. [Juridiction compétente et mode de règlement amiable préalable à préciser.]",
        ],
      },
    ],
  },
];

export const legalDocument = (slug: LegalDocument["slug"]) =>
  legalDocuments.find((d) => d.slug === slug) as LegalDocument;
