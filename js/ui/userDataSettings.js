import { el } from '../tvUtils.js';
import { showAppToast } from './toast.js';
import {
    downloadUserDataExport,
    parseUserDataImport,
    summarizeUserData,
    applyUserDataReplace,
    applyUserDataMergeLibrary
} from '../storage/userDataExport.js';

function formatSummary(summary) {
    const lines = [
        `Favorites: ${summary.favorites}`,
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
        + 'Cancel = Replace all user data with this backup.'
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

export const UserDataSettings = {
    bind() {
        const exportBtn = el('export-user-data-btn');
        const importBtn = el('import-user-data-btn');
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
    }
};
