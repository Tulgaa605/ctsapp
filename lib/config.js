function defaultApiUrl() {
  return (process.env.EXPO_PUBLIC_API_URL || 'https://64-119-30-250.sslip.io:8081').replace(/\/$/, '');
}

/** Web дээр ижил origin ашиглана — хадгалалт найдвартай ажиллана */
export function getApiUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    const { protocol, origin } = window.location;
    if (protocol === 'https:' || protocol === 'http:') {
      return origin.replace(/\/$/, '');
    }
  }
  return defaultApiUrl();
}

export const API_URL = defaultApiUrl();
