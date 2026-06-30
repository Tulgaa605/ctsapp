import { Platform } from 'react-native';
import { getApiUrl } from './config';

export const CTS_ASSET_TAG = 'CT$FS4';
const CTS_ORIGIN = 'https://ctsystem.mn';
const CTS_BASE_URL = CTS_ORIGIN;

function useCtsProxy() {
  return Platform.OS === 'web';
}

/** ctsystem.mn/api/... — CT$FS4 нь payload-ийн төгсгөлд */
export function ctsUrl(apiPath) {
  const normalized = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  if (useCtsProxy()) {
    const proxyPath = normalized.replace(/^\/api\//, '/');
    return `${getApiUrl()}/api/cts${proxyPath}`;
  }
  return `${CTS_BASE_URL}${normalized}`;
}

export function buildCtsAssetString({ raw, year, month, deviceId }) {
  return `${raw}^?${year}^?${month}^?${deviceId}^?${CTS_ASSET_TAG}`;
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

async function requestCtsString(url, payloadString) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(String(payloadString)),
  });
  return response;
}

async function requestDetails(payloadString) {
  const url = ctsUrl('/api/details');

  console.log('=== CTS details хүсэлт ===');
  console.log('URL:', url);
  console.log('Body:', payloadString);

  const response = await requestCtsString(url, payloadString);

  const responseText = await response.text();
  console.log('=== CTS details хариу ===', response.status, responseText.slice(0, 500));

  if (!response.ok) {
    throw new Error(`CTS details HTTP ${response.status}`);
  }

  return parseDetailsBody(responseText);
}

export async function sendAssetString(payloadString) {
  const url = ctsUrl('/api/asset');
  console.log('=== CTS asset илгээж байна ===');
  console.log('URL:', url);
  console.log('Body:', payloadString);

  const response = await requestCtsString(url, payloadString);

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

export async function sendAssetAll(payload) {
  const url = ctsUrl('/api/assetAll');
  console.log('=== CTS assetAll илгээж байна ===');
  console.log('URL:', url);
  console.log('Body:', JSON.stringify(payload));

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text().catch(() => '');

  console.log('=== CTS assetAll хариу ===', response.status, responseText.slice(0, 500));

  if (!response.ok) {
    throw new Error(`CTS assetAll HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 200)}` : ''}`);
  }

  return {
    status: response.status,
    raw: responseText,
    count: payload?.details?.length ?? 0,
  };
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
