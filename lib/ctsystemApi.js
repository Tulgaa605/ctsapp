import { Platform } from 'react-native';
import { API_URL } from './config';

const CTS_BASE_URL = 'https://ctsystem.mn';
export const CTS_ASSET_TAG = 'CT$FS4';

function useCtsProxy() {
  return Platform.OS === 'web';
}

function ctsUrl(path) {
  if (useCtsProxy()) {
    return `${API_URL}/api/cts${path}`;
  }
  return `${CTS_BASE_URL}${path}`;
}

export function buildCtsAssetString({ raw, year, month, deviceId }) {
  return `${raw}^?${year}^?${month}^?${deviceId}^?CT$FS4`;
}

function normalizeDetailItem(item) {
  if (!item || typeof item !== 'object' || item.error) {
    return null;
  }

  const normalized = {
    name: item.name || item.Name || item.assetName || item.ner || '',
    lord: item.lord || item.Lord || item.handler || '',
    unt: item.unt || item.unit || item.unitType || '',
    ognoo: item.ognoo || item.date || '',
    dans: item.dans || item.account || '',
    une: item.une ?? item.price ?? item.unitPrice,
  };

  const hasData =
    normalized.name ||
    normalized.lord ||
    normalized.unt ||
    normalized.dans ||
    normalized.une != null;

  return hasData ? normalized : null;
}

function parseDetailsBody(responseText) {
  let jsonData;
  try {
    jsonData = JSON.parse(responseText);
    if (typeof jsonData === 'string') {
      try {
        jsonData = JSON.parse(jsonData);
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }

  if (jsonData?.error) {
    console.warn('CTS details error:', jsonData.error);
    return null;
  }

  if (Array.isArray(jsonData)) {
    return normalizeDetailItem(jsonData[0]);
  }

  if (Array.isArray(jsonData?.data)) {
    return normalizeDetailItem(jsonData.data[0]);
  }

  return normalizeDetailItem(jsonData);
}

async function requestDetails(payloadString) {
  const url = ctsUrl('/details');

  console.log('=== CTS details хүсэлт ===');
  console.log('URL:', url);
  console.log('Body:', JSON.stringify(payloadString));

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadString),
  });

  const responseText = await response.text();
  console.log('=== CTS details хариу ===', response.status, responseText.slice(0, 500));

  if (!response.ok) {
    throw new Error(`CTS details HTTP ${response.status}`);
  }

  return parseDetailsBody(responseText);
}

export async function sendAssetString(payloadString) {
  const url = ctsUrl('/asset');
  console.log('=== CTS asset илгээж байна ===');
  console.log('URL:', url);
  console.log('Body:', JSON.stringify(payloadString));

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadString),
  });

  const responseText = await response.text().catch(() => '');

  console.log('=== CTS asset хариу ===');
  console.log('Status:', response.status);
  console.log('Body:', responseText);

  if (!response.ok) {
    throw new Error(`CTS asset HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 200)}` : ''}`);
  }

  let parsed = responseText;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    // text хариу байвал хэвээр үлдэнэ
  }

  return {
    status: response.status,
    body: parsed,
    raw: responseText,
    sent: payloadString,
  };
}

export async function sendAssetItem(item) {
  const payloadString = buildCtsAssetString({
    raw: item.raw,
    year: item.year,
    month: item.month,
    deviceId: item.deviceId || 'UNKNOWN',
  });

  return sendAssetString(payloadString);
}

export async function fetchAssetDetails({ raw, year, month, deviceId }) {
  const extended = buildCtsAssetString({ raw, year, month, deviceId });

  try {
    const fromExtended = await requestDetails(extended);
    if (fromExtended) return fromExtended;
  } catch (error) {
    console.warn('CTS details extended request failed:', error?.message);
  }

  try {
    return await requestDetails(raw);
  } catch (error) {
    console.warn('CTS details raw request failed:', error?.message);
    throw error;
  }
}

export function isDeviceOnline(isConnected) {
  if (isConnected === true) return true;
  if (isConnected === false) return false;
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    return navigator.onLine;
  }
  return true;
}
