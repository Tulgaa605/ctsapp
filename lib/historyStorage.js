import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from './config';

const HISTORY_KEY = 'history';

function withClientId(item) {
  const dbId = item.id;
  return {
    ...item,
    id: dbId
      ? String(dbId)
      : `${item.assetCode}-${item.serialNumber}-${item.createdAt}`,
  };
}

function normalizeHistory(items) {
  return items.map((item) => {
    if (!item.orgCode && item.raw) {
      const rawParts = item.raw.split('^?');
      return withClientId({ ...item, orgCode: rawParts[5] || '' });
    }
    return withClientId(item);
  });
}

async function cacheHistory(items) {
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

async function readCachedHistory() {
  const stored = await AsyncStorage.getItem(HISTORY_KEY);
  const parsed = stored ? JSON.parse(stored) : [];
  return normalizeHistory(parsed);
}

function isBrowserOnline() {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

async function apiFetch(path, options) {
  const base = getApiUrl();
  const url = `${base}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  return response;
}

export async function loadHistory() {
  const base = getApiUrl();
  try {
    const response = await apiFetch('/api/history');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const items = normalizeHistory(await response.json());
    await cacheHistory(items);
    return items;
  } catch (error) {
    console.warn('loadHistory failed:', base, error?.message || error);
    const cached = await readCachedHistory();
    if (cached.length > 0) return cached;
    return [];
  }
}

export async function saveHistoryItem(item) {
  const payload = {
    ...item,
    createdAt: item.createdAt || new Date().toISOString(),
  };

  const base = getApiUrl();

  try {
    const response = await apiFetch('/api/history', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (response.status === 409) {
      const duplicateError = new Error('DUPLICATE');
      duplicateError.code = 'DUPLICATE';
      throw duplicateError;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `HTTP ${response.status}`);
    }

    const saved = withClientId(await response.json());
    const cached = await readCachedHistory();
    const next = [saved, ...cached.filter((it) => String(it.id) !== String(saved.id))];
    await cacheHistory(next);
    return { item: saved, savedToDb: true };
  } catch (error) {
    if (error?.code === 'DUPLICATE') throw error;

    console.warn('saveHistoryItem failed:', base, error?.message || error);

    if (isBrowserOnline()) {
      throw new Error(
        `Серверт хадгалж чадсангүй (${base}).\n${error?.message || 'Холболтын алдаа'}`
      );
    }

    const cached = await readCachedHistory();
    const offlineItem = withClientId(payload);
    await cacheHistory([offlineItem, ...cached]);
    return { item: offlineItem, savedToDb: false };
  }
}

export async function deleteHistoryItems(ids) {
  const numericIds = ids
    .map((id) => Number(String(id).replace(/[^0-9].*$/, '')))
    .filter((n) => Number.isFinite(n) && n > 0);

  try {
    if (numericIds.length) {
      const response = await apiFetch('/api/history', {
        method: 'DELETE',
        body: JSON.stringify({ ids: numericIds }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn('deleteHistoryItems API failed:', error?.message || error);
  }

  try {
    const response = await apiFetch('/api/history');
    if (response.ok) {
      const items = normalizeHistory(await response.json());
      await cacheHistory(items);
      return items;
    }
  } catch (error) {
    // fallback to local filter
  }

  const cached = await readCachedHistory();
  const idSet = new Set(ids.map(String));
  const next = cached.filter((item) => !idSet.has(String(item.id)));
  await cacheHistory(next);
  return next;
}

export async function deleteAllHistory() {
  try {
    const response = await apiFetch('/api/history/all', { method: 'DELETE' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.warn('deleteAllHistory API failed:', error?.message || error);
  }

  await AsyncStorage.removeItem(HISTORY_KEY);
  return [];
}

export { normalizeHistory };
