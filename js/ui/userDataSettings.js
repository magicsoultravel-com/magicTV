import { el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import {
    downloadUserDataExport,
    parseUserDataImport,
    summarizeUserData,
    applyUserDataReplace,
    applyUserDataMergeLibrary,
    clearAllUserData,
    factoryResetUserData
} from '../storage/userDataExport.js';

function formatSummary(summary) {
    const lines = [
        `Favorites: ${summary.favorites}`,
        `Folders: ${summary.folders ?? 0}`,
        `Recents: ${summary.recents}`,
        `Hidden: ${summary.hidden}`,
        `Visited: ${summary.visited}`,
        `Watch stats: ${summary.watchStats}`
    ];
    if (summary.exportedAt) {
        const date = new Date(summary.exportedAt);
        if (!Number.isNaN(date.getTime())) {
            lines.push(`Exported: ${date.toLocaleString()}`);
        }
    }
    if (Array.isArray(summary.warnings) && summary.warnings.length) {
        lines.push('', 'Warnings:');
        for (const w of summary.warnings) lines.push(`- ${w}`);
    }
    return lines.join('\n');
}

async function handleImportFile(file) {
    if (!file) return;
    let payload;
    try {
        const text = await file.text();
        payload = parseUserDataImport(text);
    } catch (err) {
        showAppToast(err?.message || 'Could not read backup file');
        return;
    }

    const summary = summarizeUserData(payload);
    const proceed = window.confirm(
        `Import this backup?\n\n${formatSummary(summary)}\n\nPress OK to continue.`
    );
    if (!proceed) return;

    const mergeLibrary = window.confirm(
        'Merge library data only?\n\n'
        + 'OK = Merge favorites, recents, visited, hidden, and watch stats into your current data.\n'
        + 'Cancel = Replace all user data with this backup'
        + (summary.sparse
            ? ' (missing folders/settings in this file will reset to defaults).'
            : '.')
    );

    try {
        if (mergeLibrary) applyUserDataMergeLibrary(payload);
        else applyUserDataReplace(payload);
    } catch (err) {
        showAppToast(err?.message || 'Import failed');
        return;
    }

    showAppToast(mergeLibrary ? 'Library data merged — reloading…' : 'User data restored — reloading…');
    window.setTimeout(() => window.location.reload(), 400);
}

function handleFlushUserData() {
    const ok = window.confirm(
        'Flush all user data?\n\n'
        + 'This deletes favorites, folders, settings, session, watch stats, and clock/cast prefs.\n'
        + 'Tile previews and catalog caches are kept.\n\n'
        + 'Export a backup first if you might need it.'
    );
    if (!ok) return;
    try {
        clearAllUserData();
    } catch (err) {
        showAppToast(err?.message || 'Flush failed');
        return;
    }
    showAppToast('User data flushed — reloading…');
    window.setTimeout(() => window.location.reload(), 400);
}

async function handleFactoryReset() {
    const ok = window.confirm(
        'Factory reset?\n\n'
        + 'Last resort: deletes all user data AND tile/catalog caches (IndexedDB).\n'
        + 'Caches are not in exports and must rebuild after reload.\n\n'
        + 'Export a backup first if you might need it.'
    );
    if (!ok) return;
    const really = window.confirm(
        'Really factory reset?\n\nThis cannot be undone except by importing a backup.'
    );
    if (!really) return;
    try {
        await factoryResetUserData();
    } catch (err) {
        showAppToast(err?.message || 'Factory reset failed');
        return;
    }
    showAppToast('Factory reset done — reloading…');
    window.setTimeout(() => window.location.reload(), 400);
}

export const UserDataSettings = {
    bind() {
        const exportBtn = el('export-user-data-btn');
        const importBtn = el('import-user-data-btn');
        const flushBtn = el('flush-user-data-btn');
        const factoryBtn = el('factory-reset-user-data-btn');
        const fileInput = el('import-user-data-input');

        if (exportBtn && exportBtn.dataset.bound !== '1') {
            exportBtn.dataset.bound = '1';
            exportBtn.addEventListener('click', () => {
                try {
                    downloadUserDataExport();
                    showAppToast('User data exported');
                } catch {
                    showAppToast('Export failed');
                }
            });
        }

        if (importBtn && fileInput && importBtn.dataset.bound !== '1') {
            importBtn.dataset.bound = '1';
            importBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', () => {
                const file = fileInput.files?.[0];
                fileInput.value = '';
                handleImportFile(file);
            });
        }

        if (flushBtn && flushBtn.dataset.bound !== '1') {
            flushBtn.dataset.bound = '1';
            flushBtn.addEventListener('click', handleFlushUserData);
        }

        if (factoryBtn && factoryBtn.dataset.bound !== '1') {
            factoryBtn.dataset.bound = '1';
            factoryBtn.addEventListener('click', () => {
                handleFactoryReset();
            });
        }
    }
};
