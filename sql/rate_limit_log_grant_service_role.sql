-- Droits de service_role sur rate_limit_log : une table créée n'hérite d'aucun GRANT.
-- Sans ce script, les Edge Functions échouent avec une erreur au message vide.
-- Exécuté en base le 14/08/2026.

grant select, insert, delete on public.rate_limit_log to service_role;

-- Rollback :
-- revoke select, insert, delete on public.rate_limit_log from service_role;
