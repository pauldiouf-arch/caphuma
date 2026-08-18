-- ============================================================================
-- rate_limit_log_grant_service_role.sql
-- ----------------------------------------------------------------------------
-- Corrige l'incident de GRANT découvert pendant le test de la limite de débit
-- le 14/08/2026 : un CREATE TABLE n'hérite d'aucun GRANT existant (règle 30
-- du Master Context) — service_role n'avait donc aucun accès à la table qui
-- venait d'être créée. Même famille de bug que celui rencontré sur
-- share_tokens en juillet 2026 (règle 8). Symptôme observé dans les logs des
-- Edge Functions : une erreur au message vide ({ message: "" }).
--
-- Exécuté en base le : 14/08/2026
-- Versionné dans ce fichier le : 18/08/2026 (chantier A4) — reconstitué
-- fidèlement depuis information_schema.role_table_grants (jamais sauvegardé
-- en fichier au moment de l'exécution, voir Dossier de passation, Annexe B,
-- écart noté honnêtement).
-- ============================================================================

grant select, insert, delete on public.rate_limit_log to service_role;

-- ----------------------------------------------------------------------------
-- Rollback (règle 10) :
-- revoke select, insert, delete on public.rate_limit_log from service_role;
-- ----------------------------------------------------------------------------
