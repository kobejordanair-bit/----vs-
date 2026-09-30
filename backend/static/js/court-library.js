(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DynastyCourtLibrary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const TYPES = Object.freeze({ hanXin: 'general', xiaoHe: 'minister', weiZheng: 'minister' });

    // Read the live library on every visit. Never copy game trust or events into a legend.
    function createReader({ getLegends, getModifications }) {
        return function getLegend(advisor) {
            const records = getLegends();
            const matches = Array.isArray(records)
                ? records.filter(record => record && record.name === advisor.name && record.type === TYPES[advisor.id])
                : [];
            if (matches.length !== 1) {
                return { name: advisor.name, analysis: '', sourceLabel: matches.length > 1
                    ? '人物館有多個同名條目，請先在人物館確認。' : '人物館尚未載入此人物的文章。' };
            }
            const record = matches[0];
            const modifications = getModifications();
            const saved = modifications && Object.hasOwn(modifications, record.id) ? modifications[record.id] : null;
            const analysis = saved && typeof saved.deepAnalysis === 'string' ? saved.deepAnalysis
                : typeof record.deepAnalysis === 'string' ? record.deepAnalysis : '';
            const sections = [['analysis', '人物剖析'], ['soulEssence', '人格與行為解讀']].flatMap(([field, title]) => {
                const text = saved && typeof saved[field] === 'string' ? saved[field]
                    : typeof record[field] === 'string' ? record[field] : '';
                return text.trim() ? [{ title, text }] : [];
            });
            return { id: record.id, name: record.name, analysis, sections, sourceLabel: analysis.trim()
                ? '人物館已儲存的深度分析全文 · 原文保留'
                : '此人物尚未儲存深度分析；可稍後到人物館閱讀或製作。' };
        };
    }

    return Object.freeze({ createReader });
});
