const CapHumaData = (() => {

    function client() {
        if (!supabaseClient) throw new Error('supabaseClient non initialisé.');
        return supabaseClient;
    }

    async function getPools({ select = 'pool_id, name, full_name, is_archived', filters = {}, orderBy = null } = {}) {
        let q = client().from('pools').select(select);
        for (const [key, val] of Object.entries(filters)) q = q.eq(key, val);
        if (orderBy) { const [col, asc] = Array.isArray(orderBy) ? orderBy : [orderBy, true]; q = q.order(col, { ascending: asc }); }
        return capHumaWithRetry(() => q);
    }

    async function getPoolByCode(poolId, select = 'id, pool_id, full_name, level') {
        return capHumaWithRetry(() =>
            client().from('pools').select(select).eq('pool_id', poolId).single()
        );
    }

    async function updatePool(id, payload) {
        return capHumaWithRetry(() => client().from('pools').update(payload).eq('id', id));
    }

    async function createPool(payload) {
        return capHumaWithRetry(() => client().from('pools').insert(payload));
    }

    async function getTalents({ select = '*', filters = {}, orderBy = null } = {}) {
        let q = client().from('talents').select(select);
        for (const [key, val] of Object.entries(filters)) q = q.eq(key, val);
        if (orderBy) { const [col, asc] = Array.isArray(orderBy) ? orderBy : [orderBy, true]; q = q.order(col, { ascending: asc }); }
        return capHumaWithRetry(() => q);
    }

    async function getTalentById(id, select = '*') {
        return capHumaWithRetry(() =>
            client().from('talents').select(select).eq('id', id).single()
        );
    }

    async function updateTalent(id, payload, returning = null) {
        return capHumaWithRetry(() => {
            const q = client().from('talents').update(payload).eq('id', id);
            return returning ? q.select(returning) : q;
        });
    }

    async function deleteTalent(id, returning = 'id') {
        return client().from('talents').delete().eq('id', id).select(returning);
    }

    async function createTalent(payload, returning = null) {
        const q = client().from('talents').insert(payload);
        return returning ? q.select(returning) : q;
    }

    return {
        getPools, getPoolByCode, updatePool, createPool,
        getTalents, getTalentById, updateTalent, createTalent, deleteTalent
    };
})();
