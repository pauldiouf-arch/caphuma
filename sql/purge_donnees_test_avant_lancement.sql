-- Purge des données de test avant l'ouverture de Cap Huma aux utilisateurs réels : talents, postes, commentaires,
-- évaluations, liens de partage, historique des pools, demandes de nouveau code, erreurs client, compteurs de débit
-- et journal d'audit. Conserve les pools, les comptes (users) et leurs préférences de notification.
-- Avant : comptes de test supprimés depuis admin.html, bucket red-list-documents vidé depuis Storage,
-- monthly-maintenance lancée une dernière fois avec succès (sa sauvegarde est le seul retour arrière possible).
-- Après : relancer monthly-maintenance pour une première sauvegarde propre, puis supprimer du bucket backups
-- les sauvegardes antérieures, qui ne contiennent que des données de test.
-- Un seul bloc : tout s'applique ou rien. Refuse de s'exécuter tant que red-list-documents contient des fichiers.
-- Le journal est vidé en dernier : les suppressions précédentes y écrivent des lignes par déclencheur.
-- À exécuter une seule fois, le jour du lancement. Pas encore exécuté en base.

do $$
begin
    if exists (select 1 from storage.objects where bucket_id = 'red-list-documents') then
        raise exception 'Le bucket red-list-documents contient encore des fichiers : le vider depuis Storage, puis relancer ce script.';
    end if;

    delete from public.share_tokens;
    delete from public.comments;
    delete from public.evaluations;
    delete from public.pool_history;
    delete from public.missions;
    delete from public.talents;
    delete from public.access_code_requests;
    delete from public.client_error_logs;
    delete from public.rate_limit_log;
    delete from public.audit_logs;
end $$;

select 'talents (attendu : 0)' as controle, count(*) from public.talents
union all select 'missions (attendu : 0)', count(*) from public.missions
union all select 'comments (attendu : 0)', count(*) from public.comments
union all select 'evaluations (attendu : 0)', count(*) from public.evaluations
union all select 'share_tokens (attendu : 0)', count(*) from public.share_tokens
union all select 'pool_history (attendu : 0)', count(*) from public.pool_history
union all select 'access_code_requests (attendu : 0)', count(*) from public.access_code_requests
union all select 'client_error_logs (attendu : 0)', count(*) from public.client_error_logs
union all select 'rate_limit_log (attendu : 0)', count(*) from public.rate_limit_log
union all select 'audit_logs (attendu : 0)', count(*) from public.audit_logs
union all select 'pools (conservés, jamais 0)', count(*) from public.pools
union all select 'users (conservés : comptes réels uniquement)', count(*) from public.users
union all select 'notification_preferences (conservées)', count(*) from public.notification_preferences
union all select 'Storage red-list-documents (attendu : 0)', count(*) from storage.objects where bucket_id = 'red-list-documents'
union all select 'Storage backups (à nettoyer après la première sauvegarde propre)', count(*) from storage.objects where bucket_id = 'backups';

-- Rollback : aucune annulation par script. Restaurer les tables depuis la dernière sauvegarde du bucket backups
-- (fichier JSON de monthly-maintenance lancée juste avant la purge).
