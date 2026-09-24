const CapHumaData = (() => {

    async function getPools(sb, { select = 'pool_id, name, full_name, is_archived', filters = {}, orderBy = null } = {}) {
        let q = sb.from('pools').select(select);
        for (const [key, val] of Object.entries(filters)) q = q.eq(key, val);
        if (orderBy) { const [col, asc] = Array.isArray(orderBy) ? orderBy : [orderBy, true]; q = q.order(col, { ascending: asc }); }
        return capHumaWithRetry(() => q);
    }

    async function updatePool(sb, id, payload) {
        return capHumaWithRetry(() => sb.from('pools').update(payload).eq('id', id).select('id'));
    }

    async function createPool(sb, payload) {
        return sb.from('pools').insert(payload);
    }

    async function deletePool(sb, id) {
        return sb.from('pools').delete().eq('id', id).select('id');
    }

    async function getPoolUsage(sb) {
        const [talents, missions, history] = await Promise.all([
            capHumaSelectAllPages(() => sb.from('talents').select('pool, tracking_pool', { count: 'exact' }).order('id')),
            capHumaSelectAllPages(() => sb.from('missions').select('pool', { count: 'exact' }).order('id')),
            capHumaSelectAllPages(() => sb.from('pool_history').select('from_pool, to_pool', { count: 'exact' }).order('id'))
        ]);
        const error = talents.error || missions.error || history.error;
        if (error) return { data: null, error };

        const usage = {};
        const entry = code => (usage[code] = usage[code] || { talents: 0, missions: 0, history: 0 });
        talents.data.forEach(t => {
            if (t.pool) entry(t.pool).talents++;
            if (t.tracking_pool && t.tracking_pool !== t.pool) entry(t.tracking_pool).talents++;
        });
        missions.data.forEach(m => { if (m.pool) entry(m.pool).missions++; });
        history.data.forEach(h => {
            if (h.from_pool) entry(h.from_pool).history++;
            if (h.to_pool && h.to_pool !== h.from_pool) entry(h.to_pool).history++;
        });
        return { data: usage, error: null };
    }

    async function getTalents(sb, { select = '*', filters = {}, orderBy = null } = {}) {
        return capHumaSelectAllPages(() => {
            let q = sb.from('talents').select(select, { count: 'exact' });
            for (const [key, val] of Object.entries(filters)) q = q.eq(key, val);
            if (orderBy) { const [col, asc] = Array.isArray(orderBy) ? orderBy : [orderBy, true]; q = q.order(col, { ascending: asc }); }
            return q.order('id');
        });
    }

    async function updateTalent(sb, id, payload, returning = null) {
        return capHumaWithRetry(() => {
            const q = sb.from('talents').update(payload).eq('id', id);
            return returning ? q.select(returning) : q;
        });
    }

    async function createTalent(sb, payload, returning = null) {
        const q = sb.from('talents').insert(payload);
        return returning ? q.select(returning) : q;
    }

    async function removeRedListDocuments(sb, paths) {
        if (!Array.isArray(paths) || paths.length === 0) return true;
        try {
            const { data, error } = await sb.storage.from('red-list-documents').remove(paths);
            if (error) throw error;
            // Un refus RLS du stockage ne renvoie pas d'erreur, seulement moins de fichiers supprimés.
            if (!data || data.length < paths.length) throw new Error(`${data ? data.length : 0} fichier(s) supprimé(s) sur ${paths.length}`);
            return true;
        } catch (err) {
            console.error('[Liste rouge] Documents restés dans le stockage :', paths, err);
            return false;
        }
    }

    async function deleteTalentPermanently(sb, id) {
        // Sans capHumaWithRetry() : une relance après succès renverrait 0 ligne et ferait croire à un blocage RLS.
        const { data, error } = await sb.from('talents').delete().eq('id', id).select('id, red_list_documents');
        if (error) throw error;
        if (!data || data.length === 0) {
            throw new Error("La suppression n'a affecté aucune ligne (policy RLS ?).");
        }
        return { documentsRemoved: await removeRedListDocuments(sb, data[0].red_list_documents) };
    }

    return {
        getPools, updatePool, createPool, deletePool, getPoolUsage,
        getTalents, updateTalent, createTalent,
        removeRedListDocuments, deleteTalentPermanently
    };
})();
