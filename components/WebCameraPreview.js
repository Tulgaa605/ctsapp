import { Platform } from 'react-native';

export async function requestWebCameraStream() {
    if (Platform.OS !== 'web') return null;
    return null;
}

export function getWebCameraErrorMessage(error) {
    return error?.message || 'Камер нээхэд алдаа гарлаа';
}

export default function WebCameraPreview() {
    return null;
}
