(function (root, factory) {
    'use strict';
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DynastySourceLinks = api;
}(typeof globalThis === 'object' ? globalThis : this, function (root) {
    'use strict';

    function hrefForRecordId(recordId) {
        if (typeof recordId !== 'string' || !recordId.trim() || /[\u0000-\u001f\u007f]/.test(recordId)) return null;
        const hash = new URLSearchParams({ tab: 'people', person: recordId });
        return '/source-archive#' + hash.toString();
    }

    function clear(document = root.document) {
        if (!document) return;
        const bar = document.getElementById('personSourceBar');
        const link = document.getElementById('personSourceLink');
        if (bar) bar.classList.add('hidden');
        if (link) {
            link.removeAttribute('href');
            link.removeAttribute('aria-label');
            link.removeAttribute('data-record-id');
        }
    }

    function setPerson(record, document = root.document) {
        clear(document);
        const href = hrefForRecordId(record && record.id);
        if (!href || !document) return false;
        const bar = document.getElementById('personSourceBar');
        const link = document.getElementById('personSourceLink');
        if (!bar || !link) return false;
        // Keep the original record ID: identical names can have distinct dossiers.
        link.setAttribute('href', href);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        link.setAttribute('data-record-id', record.id);
        link.setAttribute('aria-label', '查看' + (typeof record.name === 'string' ? record.name : '此人物') + '的史料（在新分頁開啟）');
        link.textContent = '查看史料 ↗';
        bar.classList.remove('hidden');
        return true;
    }

    return Object.freeze({ hrefForRecordId, setPerson, clear });
}));
