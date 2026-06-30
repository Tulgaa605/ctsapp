import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import jsQR from 'jsqr';

function findVideoElement(root) {
    if (!root) return null;
    if (root.tagName === 'VIDEO') return root;
    if (typeof root.querySelector === 'function') {
        return root.querySelector('video');
    }
    return null;
}

export function useWebJsQrScan(containerRef, enabled, onScan) {
    const onScanRef = useRef(onScan);
    onScanRef.current = onScan;

    useEffect(() => {
        if (Platform.OS !== 'web' || !enabled) return undefined;

        let cancelled = false;
        let raf = null;
        const canvas = document.createElement('canvas');

        const tick = () => {
            if (cancelled) return;

            const video = findVideoElement(containerRef.current);
            if (!video || video.readyState < video.HAVE_ENOUGH_DATA) {
                raf = requestAnimationFrame(tick);
                return;
            }

            const width = video.videoWidth;
            const height = video.videoHeight;
            if (!width || !height) {
                raf = requestAnimationFrame(tick);
                return;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(video, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            const result = jsQR(imageData.data, width, height, { inversionAttempts: 'attemptBoth' });

            if (result?.data) {
                onScanRef.current?.({ data: result.data });
                return;
            }

            raf = requestAnimationFrame(tick);
        };

        const startTimer = setTimeout(() => {
            raf = requestAnimationFrame(tick);
        }, 300);

        return () => {
            cancelled = true;
            clearTimeout(startTimer);
            if (raf) cancelAnimationFrame(raf);
        };
    }, [containerRef, enabled]);
}
