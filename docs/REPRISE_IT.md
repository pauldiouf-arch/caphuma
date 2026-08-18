# Cap Huma — ce que la reprise implique

**Pour le service IT d'ALIMA.** Cette page se lit en cinq minutes. À la fin,
vous savez ce que l'adoption de cet outil vous coûte en temps, en argent et en
décisions à prendre. Elle ne cherche pas à vendre le projet.

---

## De quoi parle-t-on

Cap Huma est une application web interne de gestion du vivier de talents
humanitaires : fiches candidats, affectation aux postes terrain, historique des
missions, statistiques, liste de signalement sécuritaire, journal d'audit.
Environ 15 à 20 utilisateurs, trois niveaux d'accès (administrateur, recruteur,
lecture seule).

**Ce que vous récupérez techniquement :**

- Un site **100 % statique** (HTML, CSS, JavaScript). Pas de framework, pas
  d'étape de compilation, pas de serveur applicatif à administrer. Aujourd'hui
  publié sur GitHub Pages ; n'importe quel hébergeur de fichiers statiques
  ferait l'affaire.
- Un projet **Supabase** qui porte toute la donnée et toute la sécurité : base
  Postgres, authentification, stockage de fichiers, et trois fonctions serveur.
- Une documentation technique complète, tenue à jour à chaque intervention
  (voir la fin de cette page).

**État actuel :** l'outil est fonctionnel et testé, mais la base ne contient
aujourd'hui que des **données fictives**. Rien n'est en production. C'est
volontaire : l'ouverture aux utilisateurs réels est conditionnée à votre
validation.

---

## Les cinq actions de la reprise

### Action 1 — Transférer les comptes vers ALIMA

**Le point le plus important de cette page.** Cinq services tiers font
fonctionner Cap Huma, et chacun est aujourd'hui rattaché à un compte
individuel :

| Service | Ce qu'il fait |
|---|---|
| Hébergement du code | Publie le site |
| Supabase | Base de données, comptes utilisateurs, fonctions serveur |
| Fournisseur du modèle d'IA | Analyse statistique assistée |
| Surveillance du traitement mensuel | Alerte si la maintenance automatique ne tourne plus |
| Surveillance de disponibilité du site | Alerte si le site ne répond plus |

Tant que ces comptes restent individuels, le départ d'une seule personne
suffit à faire perdre à ALIMA l'accès à son propre outil — y compris à ses
données.

**À faire :** créer une organisation ALIMA sur chacun de ces services, y
transférer la propriété, et désigner **au moins deux propriétaires** par
service. Jamais un seul.

*Les identifiants et le détail de chaque compte figurent dans le fichier
`.env`, conservé sur le Drive à accès restreint (voir `README.md` de ce
dossier). Ils ne sont volontairement pas reproduits ici.*

**Coût :** quelques heures. Aucune dépense.

### Action 2 — Passer Supabase en plan payant

Le projet tourne aujourd'hui sur le plan **gratuit**, ce qui implique quatre
limites qui ne sont pas acceptables en production :

- **Aucune sauvegarde native.** Une sauvegarde mensuelle a été programmée
  manuellement pour compenser (voir Action 5).
- **Mise en veille du projet après environ une semaine sans activité.** Un mois
  d'août avec vingt personnes en congé suffit à la déclencher, et le traitement
  mensuel automatique peut alors ne pas s'exécuter.
- **Pas de vérification des mots de passe compromis.** Supabase sait refuser un
  mot de passe apparaissant dans une fuite connue, mais cette protection est
  réservée au plan payant. Elle est donc désactivée aujourd'hui.
- **Aucun engagement de service**, et des conditions de plan gratuit
  susceptibles d'évoluer plusieurs fois en cinq ans.

**Coût :** environ 25 $ par mois. C'est la meilleure assurance du projet, et la
personne qui l'a construit ne peut pas la souscrire elle-même.

**À prévoir en même temps :** le fournisseur du modèle d'IA est lui aussi sur
un palier gratuit. Or, d'après la documentation de ce fournisseur, le passage à
un compte facturé est précisément ce qui garantit que les requêtes envoyées ne
sont pas réutilisées pour améliorer ses produits — sur le palier gratuit, elles
peuvent l'être, avec possibilité de relecture humaine.

Aujourd'hui, seules des **données agrégées** sont transmises (des comptages,
jamais un nom), ce qui limite fortement la portée du sujet. Mais activer un
compte de facturation supprime la question. Au volume d'usage réel de l'outil
— quelques analyses par mois — la dépense serait proche de zéro ; c'est une
formalité administrative (carte bancaire à renseigner), pas un budget.

**Point à vérifier :** des conditions particulières s'appliquent
potentiellement aux utilisateurs situés dans l'Espace économique européen. Les
sources publiques se contredisent sur ce point. À vérifier directement dans les
conditions d'utilisation du fournisseur au moment de la reprise, avant
d'ouvrir l'outil aux utilisateurs.

### Action 3 — Faire tourner les trois secrets

Le projet a trois secrets sensibles : la clé d'administration de la base
(qui contourne toutes les règles de sécurité), la clé du fournisseur d'IA, et
le secret qui protège le déclenchement du traitement mensuel.

Ils n'ont jamais fuité à notre connaissance, mais ils ont été manipulés pendant
la construction et figurent dans un fichier sur un espace partagé. **Personne
ne peut garantir qui a eu ces valeurs sous les yeux.** Le jour de la reprise,
les trois doivent être régénérés **ensemble**.

La procédure détaillée, avec les tests à faire après rotation pour confirmer
que tout refonctionne, est dans le guide de maintenance (§2.4 et §2.4 ter).

**Coût :** une à deux heures, une seule fois.

### Action 4 — Dépôt privé et domaine ALIMA

Le code est aujourd'hui dans un dépôt **public** et publié sur une adresse
personnelle. Le passage sous le contrôle d'ALIMA suppose un dépôt privé et,
si vous le souhaitez, un domaine ALIMA.

> ⚠️ **Piège à connaître avant de déménager le site.** Deux des trois fonctions
> serveur n'acceptent les requêtes que depuis l'adresse actuelle du site, codée
> en dur dans leur configuration (`ALLOWED_ORIGIN`). **Changer de domaine sans
> mettre à jour cette valeur casse l'administration des comptes et l'analyse
> IA**, avec une erreur réseau peu explicite côté navigateur. C'est le premier
> réflexe à avoir si quelque chose cesse de fonctionner après un déménagement.

**Coût :** quelques heures, plus le coût du domaine s'il en faut un.

### Action 5 — Sortir une copie des sauvegardes de Supabase

Une sauvegarde complète de la base est déposée automatiquement chaque mois…
**dans un espace de stockage du même projet Supabase.** Si ce projet disparaît
— compte fermé, suppression accidentelle, litige avec le fournisseur — les
sauvegardes disparaissent avec lui.

**À faire :** ajouter à la routine mensuelle le téléchargement de la dernière
sauvegarde vers un espace ALIMA (Drive restreint ou équivalent), et réaliser
**au moins une fois** un test de restauration réel pour vérifier que ces
fichiers sont effectivement exploitables. Une sauvegarde jamais restaurée n'est
pas une sauvegarde vérifiée.

**Coût :** cinq minutes par mois, plus une demi-journée pour le test de
restauration initial.

---

## Avant d'ouvrir l'outil aux utilisateurs réels

La base ne contient que des données de test. Un script de purge est prêt et
documenté (Annexe B du dossier de passation) : il vide les fiches, les postes,
les commentaires, les évaluations, les liens de partage et le journal d'audit,
tout en conservant la configuration et les comptes.

**Consignez la date d'exécution et le nom de la personne qui l'a lancé.** C'est
la première ligne du registre de traitement de l'outil, et la preuve qu'aucune
donnée de test ne s'est mélangée aux données réelles.

---

## Les décisions qui ne sont pas techniques

Trois points n'ont volontairement pas été tranchés, parce qu'ils ne relèvent
pas d'un choix technique. **Aucun référent RGPD n'étant identifié à ce jour
pour cet outil, la première décision consiste à désigner qui tranche les deux
suivantes.**

1. **L'envoi de données agrégées à un modèle d'IA externe est-il acceptable ?**
   Aucune donnée nominative n'est transmise aujourd'hui. Mais cette garantie
   repose sur la façon dont le code est écrit, pas sur un contrôle côté serveur
   (un renforcement est prévu, voir la feuille de route). La question est de
   savoir si ce niveau de garantie vous suffit.

2. **Que doit contenir un lien de partage public ?** L'outil permet de générer
   un lien temporaire donnant accès à une fiche talent sans compte. Ce lien
   expose aujourd'hui, entre autres, l'adresse e-mail, le genre, la nationalité
   et la situation de visa de la personne. Les fiches signalées en liste rouge
   en sont exclues automatiquement. Faut-il réduire ce contenu ?

---

## Ce que la reprise ne vous demande pas

Utile à savoir pour dimensionner la charge :

- **Aucun serveur à administrer**, aucun conteneur, aucune mise à jour système.
- **Aucune chaîne de compilation**, aucun gestionnaire de paquets. Modifier une
  page consiste à éditer un fichier et à le déposer.
- **Aucune dépendance externe au chargement** : les quatre bibliothèques
  utilisées sont copiées dans le dépôt et figées. Une panne chez un tiers
  n'empêche pas le site de fonctionner.
- **Aucune migration de données** : la base reste où elle est, seul le
  propriétaire du compte change.

---

## Ce que vous devez savoir des limites

Par honnêteté, et parce que vous les découvririez de toute façon :

- **Une seule personne connaît ce système**, et ce n'est pas une développeuse
  professionnelle. La documentation existe précisément pour compenser, mais
  elle ne remplace pas un second interlocuteur technique. Identifier cette
  personne pendant que l'auteure est encore disponible est le meilleur
  investissement possible.
- **Aucun test automatisé.** La validation repose sur une checklist manuelle,
  rejouée après chaque modification.
- **Aucun environnement de test séparé.** Un second projet Supabase gratuit
  serait à créer avant toute manipulation risquée.
- **Le déploiement se fait sans filet** : pas de revue avant mise en ligne, pas
  de retour arrière en un clic.

Aucun de ces points n'est bloquant à l'échelle de l'outil. Tous sont documentés
en détail, avec les pistes de correction, dans le dossier de passation.

---

## Pour aller plus loin

Le fichier `README.md` de ce dossier indique où trouver la documentation
complète : dossier de passation technique (schéma de base, règles de sécurité,
fragilités connues), guide d'architecture et de maintenance (procédures
récurrentes, déploiement pas à pas), et la feuille de route des chantiers
ouverts.

**Contact pendant la transition :** la personne ayant construit et maintenu
l'outil au sein d'ALIMA, joignable via le service IT.

*Page rédigée le 18/08/2026.*
