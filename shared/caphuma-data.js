const CapHumaData = (() => {

    async function getPools(sb, { select = 'pool_id, name, full_name, is_archived', filters = {}, orderBy = null } = {}) {
        let q = sb.from('pools').select(select);
        for (const [key, val] of Object.entries(filters)) q = q.eq(key, val);
        if (orderBy) { const [col, asc] = Array.isArray(orderBy) ? orderBy : [orderBy, true]; q = q.order(col, { ascending: asc }); }
        return capHumaWithRetry(() => q);
    }

    async function updatePool(sb, id, payload) {
        return capHumaWithRetry(() => sb.from('pools').update(payload).eq('id', id));
    }

    async function createPool(sb, payload) {
        return capHumaWithRetry(() => sb.from('pools').insert(payload));
    }

    async function getTalents(sb, { select = '*', filters = {}, orderBy = null } = {}) {
        let q = sb.from('talents').select(select);
        for (const [key, val] of Object.entries(filters)) q = q.eq(key, val);
        if (orderBy) { const [col, asc] = Array.isArray(orderBy) ? orderBy : [orderBy, true]; q = q.order(col, { ascending: asc }); }
        return capHumaWithRetry(() => q);
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
        getPools, updatePool, createPool,
        getTalents, updateTalent, createTalent,
        removeRedListDocuments, deleteTalentPermanently
    };
})();
