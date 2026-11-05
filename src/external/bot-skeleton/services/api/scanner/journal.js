// Persistent trade journal, stored in localforage. Each entry is a
// snapshot of the scanner state at entry time. You can later query this
// (via the UI) to see which signals fired, with which scores, and which
// way the trade went.
import localforage from 'localforage';

const store = localforage.createInstance({ name: 'scanner-journal', storeName: 'entries' });

export const append = async entry => {
    try {
        await store.put(entry, `${entry.ts}-${entry.market}`);
    } catch {
        // ignore quota/availability failures
    }
};

export const clear = async () => {
    try {
        await store.clear();
    } catch {
        // ignore
    }
};

export const query = async ({ session_id = null, limit = 200 } = {}) => {
    try {
        const keys = await store.keys();
        // localforage has no ordering; we just sort by key which encodes ts.
        const entries = [];
        for (const k of keys) {
            const e = await store.getItem(k);
            if (e && (!session_id || e.session_id === session_id)) entries.push(e);
            if (entries.length >= limit) break;
        }
        return entries.sort((a, b) => b.ts - a.ts);
    } catch {
        return [];
    }
};