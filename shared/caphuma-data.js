const CapHumaData = (() => {

    async function getPools(sb, { select = 'pool_id, name, full_name, is_archived', filters = {}, orderBy = null } = {}) {
        let q = sb.from('pools').select(select);
        for (const [key, val] of Object.entries(filters)) q = q.eq(key, val);
        if (orderBy) { const [col, asc] = Array.isArray(orderBy) ? orderBy : [orderBy, true]; q = q.order(col, { ascending: asc }); }
        return capHumaWithRetry(() => q);
    }

    async function getPoolByCode(sb, poolId, select = 'id, pool_id, full_name, level') {
        return capHumaWithRetry(() =>
            sb.from('pools').select(select).eq('pool_id', poolId).single()
        );
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

    async function getTalentById(sb, id, select = '*') {
        return capHumaWithRetry(() =>
            sb.from('talents').select(select).eq('id', id).single()
        );
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

    async function deleteTalent(sb, id, returning = 'id') {
        return sb.from('talents').delete().eq('id', id).select(returning);
    }

    return {
        getPools, getPoolByCode, updatePool, createPool,
        getTalents, getTalentById, updateTalent, createTalent, deleteTalent
    };
})();
