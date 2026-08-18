# Cap Huma — où trouver la documentation

Ce dépôt contient le **code** de Cap Huma, la plateforme interne de gestion du
vivier de talents d'ALIMA. Il ne contient **pas** la documentation technique
complète, qui est conservée ailleurs (voir ci-dessous).

Si vous découvrez ce dépôt sans contexte, cette page est le bon point de départ.

---

## Ce qui est dans ce dépôt

| Emplacement | Contenu |
|---|---|
| Racine (`*.html`) | Les 15 pages du site (HTML + JS, sans étape de build) |
| `shared/` | Le code JS commun à toutes les pages (`caphuma-config.js`, `caphuma-utils.js`, `caphuma-auth.js`) |
| `shared/vendor/` | Les 4 bibliothèques externes, hébergées localement et figées en version (Tailwind, supabase-js, chart.js, xlsx) |
| `sql/` | Le code source versionné des objets de base de données conservés dans le dépôt |
| `templates/` | Le modèle Excel d'import en masse de talents |
| `docs/` | Cette page, et les documents destinés à une reprise du projet |

Le site est **100 % statique** : pas de framework, pas de build, pas de serveur
à faire tourner. Les données, l'authentification et la sécurité sont assurées
par un projet **Supabase** (Postgres + Auth + Storage + Edge Functions).

## Ce qui n'est pas dans ce dépôt, et pourquoi

- **La documentation technique complète** — choix volontaire : elle décrit en
  détail le schéma de base, les policies de sécurité et les fragilités connues
  du système, ce qui n'a pas sa place dans un dépôt public.
- **Le code des 3 Edge Functions** (`manage-users`, `ai-proxy`,
  `monthly-maintenance`), qui vit dans le projet Supabase.
- **Les secrets** (clé `service_role`, clé API du modèle d'IA, secret du Cron),
  qui ne sont stockés que dans les Secrets des Edge Functions Supabase et dans
  un fichier `.env` conservé hors dépôt, sur un espace à accès restreint.

> **À ne pas confondre** : le fichier `shared/caphuma-config.js` contient bien
> une clé Supabase, mais c'est la clé **publique** (« anon » / « publishable »),
> conçue par Supabase pour être exposée au navigateur. La sécurité réelle repose
> sur les policies RLS et les GRANT côté serveur, pas sur le secret de cette clé.

---

## Où est la documentation complète

Dans un dossier Google Drive d'ALIMA, **à accès restreint** :

> 📁 [Documentation Cap Huma — Drive ALIMA](https://drive.google.com/drive/folders/15FaGMRxc4QItR9EFJ5z1NvoGDIzo56AA)
>
> *Ce lien ne donne pas d'accès par lui-même : le dossier est restreint aux
> personnes explicitement autorisées. Pour demander un accès, voir le contact
> en bas de page.*

Elle comprend :

| Document | À quoi il sert |
|---|---|
| `DOSSIER_PASSATION_TECHNIQUE.md` | La référence technique exhaustive : schéma de base table par table, policies de sécurité, code des Edge Functions, inventaire fichier par fichier, fragilités connues |
| `GUIDE_ARCHITECTURE_ET_MAINTENANCE.md` | Les procédures récurrentes : checklist avant modification, checklist mensuelle, rotation des clés, déploiement pas à pas |
| `FINAL_MASTER_CONTEXT.md` | Le contexte, les règles de méthode et les chantiers ouverts — le document à lire en premier pour comprendre *pourquoi* le projet est fait comme il est fait |
| `Cap_Huma_Presentation_Generale.docx` | La présentation fonctionnelle, pour un lecteur non technique |
| Scripts SQL exécutés en base | Historique des modifications de la base de données |

**Dernière synchronisation de ce renvoi : 18/08/2026.**

## Contact

**Service IT — ALIMA.**
*(Adresse de contact officielle à renseigner ici dès qu'elle est arrêtée.)*
