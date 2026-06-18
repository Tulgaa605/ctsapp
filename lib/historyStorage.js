import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from './config';

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

async function apiFetch(path, options) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  return response;
}

export async function loadHistory() {
  try {
    const response = await apiFetch('/api/history');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const items = normalizeHistory(await response.json());
    await cacheHistory(items);
    return items;
  } catch (error) {
    return readCachedHistory();
  }
}

export async function saveHistoryItem(item) {
  const payload = {
    ...item,
    createdAt: item.createdAt || new Date().toISOString(),
  };

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
      throw new Error(await response.text());
    }

    const saved = withClientId(await response.json());
    const cached = await readCachedHistory();
    const next = [saved, ...cached.filter((it) => String(it.id) !== String(saved.id))];
    await cacheHistory(next);
    return { item: saved, savedToDb: true };
  } catch (error) {
    if (error?.code === 'DUPLICATE') throw error;

    const cached = await readCachedHistory();
    const offlineItem = withClientId(payload);
    await cacheHistory([offlineItem, ...cached]);
    return { item: offlineItem, savedToDb: false };
  }
}

export async function deleteHistoryItems(ids) {
  const numericIds = ids.map((id) => Number(id)).filter(Boolean);

  try {
    if (numericIds.length) {
      const response = await apiFetch('/api/history', {
        method: 'DELETE',
        body: JSON.stringify({ ids: numericIds }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    // offline delete below still updates local cache
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
    // still clear local cache
  }

  await AsyncStorage.removeItem(HISTORY_KEY);
  return [];
}

export { normalizeHistory };
