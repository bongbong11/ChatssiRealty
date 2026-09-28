// Compact, character-local memory. Old saves need no eager migration.
export const HISTORY_CAP = 96;
export function normalizeKey(value) {
    return typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') : '';
}
export function compactItem(item) {
    return { name: String(item.name || '').slice(0, 100), conceptKey: String(item.conceptKey || '').slice(0, 80) };
}
export function rememberItems(data, items) {
    const history = Array.isArray(data.generationHistory) ? data.generationHistory : [];
    const unique = new Map();
    for (const item of [...history, ...items]) {
        if (!item || !normalizeKey(item.name)) continue;
        const entry = compactItem(item);
        const key = normalizeKey(entry.conceptKey || entry.name);
        unique.delete(key);
        unique.set(key, entry);
    }
    data.generationHistory = [...unique.values()].slice(-HISTORY_CAP);
}
export function planBatch(total, pinned, specialTarget) {
    const count = Math.max(0, total - pinned.length);
    // Unlocked specials still count; unlockCost records their original classification.
    const pinnedSpecial = pinned.filter(it => Number(it.unlockCost) > 0).length;
    return { total, count, specialCount: Math.min(count, Math.max(0, specialTarget - pinnedSpecial)) };
}
export function selectUnique(items, excluded, limit) {
    const names = new Set(excluded.map(it => normalizeKey(it.name)).filter(Boolean));
    const concepts = new Set(excluded.map(it => normalizeKey(it.conceptKey)).filter(Boolean));
    const accepted = [];
    for (const item of Array.isArray(items) ? items : []) {
        if (accepted.length >= limit) break;
        if (!item || typeof item.name !== 'string') continue;
        const name = normalizeKey(item.name), concept = normalizeKey(item.conceptKey);
        if (!name || names.has(name) || (concept && concepts.has(concept))) continue;
        names.add(name);
        if (concept) concepts.add(concept);
        accepted.push(item);
    }
    return accepted;
}
export function finalizeBatch(items, specialCount, food = false) {
    let remaining = specialCount;
    return items.map(item => {
        const special = Number(item.unlockCost) > 0 && typeof item.tmi === 'string' && item.tmi.trim() && remaining > 0;
        if (special) remaining--;
        return { ...item, unlockCost: special ? Math.max(5, Math.min(15, Math.round(Number(item.unlockCost)) || 5)) : 0,
            ...(food && !special ? { tmi: '' } : {}) };
    });
}
