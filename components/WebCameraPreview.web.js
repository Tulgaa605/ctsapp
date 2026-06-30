import React, { useCallback, useEffect, useRef, useState } from 'react';

export async function requestWebCameraStream() {
    const attempts = [
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: true },
    ];

    let lastError;
    for (const constraints of attempts) {
        try {
            return await navigator.mediaDevices.getUserMedia({ audio: false, ...constraints });
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('Камер нээхэд алдаа гарлаа');
}

export function getWebCameraErrorMessage(error) {
    const name = error?.name || '';
    if (name === 'NotAllowedError') return 'Камерын зөвшөөрөл татгалзсан. Браузерын тохиргооноос зөвшөөрнө үү.';
    if (name === 'NotFoundError') return 'Камер олдсонгүй.';
    if (name === 'NotReadableError') return 'Камер өөр програмд ашиглагдаж байна.';
    if (!window.isSecureContext) return 'Камер ажиллахын тулд HTTPS хаягаар нээнэ үү.';
    return error?.message || 'Камер нээхэд алдаа гарлаа';
}

export default function WebCameraPreview({ stream, onError, onReady }) {
    const onErrorRef = useRef(onError);
    const onReadyRef = useRef(onReady);
    const streamRef = useRef(stream);
    const [ready, setReady] = useState(false);

    onErrorRef.current = onError;
    onReadyRef.current = onReady;
    streamRef.current = stream;

    useEffect(() => {
        setReady(false);
    }, [stream]);

    const attachVideo = useCallback(async (video) => {
        const activeStream = streamRef.current;
        if (!video || !activeStream) return;

        video.srcObject = activeStream;
        try {
            await video.play();
            setReady(true);
            onReadyRef.current?.(video);
        } catch (error) {
            setReady(false);
            onErrorRef.current?.(getWebCameraErrorMessage(error));
        }
    }, []);

    const setVideoRef = useCallback((node) => {
        if (!node) {
            setReady(false);
            return;
        }
        attachVideo(node);
    }, [attachVideo]);

    if (!stream) return null;

    return (
        <div
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100%',
                height: '100%',
                overflow: 'hidden',
                backgroundColor: '#000',
                zIndex: 1,
            }}
        >
            <video
                ref={setVideoRef}
                autoPlay
                playsInline
                muted
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                    backgroundColor: '#000',
                }}
            />
            {!ready && (
                <div
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: 14,
                        background: 'rgba(0,0,0,0.55)',
                    }}
                >
                    Камер ачааллаж байна...
                </div>
            )}
        </div>
    );
}
