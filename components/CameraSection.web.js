import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

async function getCameraStream() {
    const attempts = [
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { facingMode: 'user' } },
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

function getErrorMessage(error) {
    const name = error?.name || '';
    if (name === 'NotAllowedError') return 'Камерын зөвшөөрөл татгалзсан.';
    if (name === 'NotFoundError') return 'Камер олдсонгүй.';
    if (name === 'NotReadableError') return 'Камер өөр програмд ашиглагдаж байна.';
    if (!window.isSecureContext) return 'HTTPS хаягаар нээнэ үү.';
    return error?.message || 'Камер нээхэд алдаа гарлаа';
}

export default function CameraSection({ onScan, scanPaused, onRescanRequest }) {
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const scanRef = useRef(onScan);
    const scanPausedRef = useRef(scanPaused);
    const rafRef = useRef(null);
    const canvasRef = useRef(null);

    const [status, setStatus] = useState('idle');
    const [errorText, setErrorText] = useState('');

    scanRef.current = onScan;
    scanPausedRef.current = scanPaused;

    const stopStream = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
    };

    const stopScanning = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
    };

    const startScanning = () => {
        stopScanning();
        const canvas = canvasRef.current || document.createElement('canvas');
        canvasRef.current = canvas;

        const tick = () => {
            if (scanPausedRef.current) {
                rafRef.current = requestAnimationFrame(tick);
                return;
            }

            const video = videoRef.current;
            if (!video || video.readyState < video.HAVE_ENOUGH_DATA) {
                rafRef.current = requestAnimationFrame(tick);
                return;
            }

            const width = video.videoWidth;
            const height = video.videoHeight;
            if (!width || !height) {
                rafRef.current = requestAnimationFrame(tick);
                return;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(video, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            const result = jsQR(imageData.data, width, height, { inversionAttempts: 'attemptBoth' });

            if (result?.data) {
                scanRef.current?.({ data: result.data });
                return;
            }

            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
    };

    const openCamera = async () => {
        setErrorText('');
        setStatus('loading');
        stopStream();
        stopScanning();

        try {
            if (!navigator?.mediaDevices?.getUserMedia) {
                throw new Error('Браузер камер дэмжихгүй.');
            }
            if (!window.isSecureContext) {
                throw new Error('HTTPS хаягаар нээнэ үү.');
            }

            const stream = await getCameraStream();
            streamRef.current = stream;

            const video = videoRef.current;
            if (!video) throw new Error('Video элемент олдсонгүй.');

            video.srcObject = stream;
            await video.play();
            setStatus('live');
        } catch (error) {
            stopStream();
            setErrorText(getErrorMessage(error));
            setStatus('error');
        }
    };

    useEffect(() => {
        if (status === 'live') {
            startScanning();
        } else {
            stopScanning();
        }
        return stopScanning;
    }, [status]);

    useEffect(() => {
        if (scanPaused && status === 'live') {
            setStatus('paused');
        }
    }, [scanPaused, status]);

    useEffect(() => () => {
        stopScanning();
        stopStream();
    }, []);

    const handleRescan = () => {
        onRescanRequest?.();
        setErrorText('');
        openCamera();
    };

    const canOpen = status === 'idle' || status === 'error';

    const boxStyle = {
        width: '100%',
        maxWidth: 420,
        height: 320,
        marginBottom: 30,
        borderRadius: 10,
        border: '3px solid #5dade2',
        overflow: 'hidden',
        backgroundColor: '#1a1a2e',
        position: 'relative',
        alignSelf: 'center',
        cursor: canOpen ? 'pointer' : 'default',
    };

    return (
        <div
            style={boxStyle}
            onClick={canOpen ? openCamera : undefined}
            role={canOpen ? 'button' : undefined}
            tabIndex={canOpen ? 0 : undefined}
            onKeyDown={canOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') openCamera(); } : undefined}
        >
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: status === 'live' || status === 'paused' ? 'block' : 'none',
                    backgroundColor: '#000',
                }}
            />

            {canOpen && (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 20,
                        gap: 14,
                    }}
                >
                    <div style={{ fontSize: 52 }}>📷</div>
                    <div
                        style={{
                            backgroundColor: '#3498db',
                            color: '#fff',
                            borderRadius: 8,
                            padding: '14px 32px',
                            fontSize: 17,
                            fontWeight: 'bold',
                            pointerEvents: 'none',
                        }}
                    >
                        Камер нээх
                    </div>
                    {errorText && (
                        <span style={{ color: '#fca5a5', fontSize: 13, textAlign: 'center' }}>
                            {errorText}
                        </span>
                    )}
                </div>
            )}

            {status === 'loading' && (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: 15,
                        background: 'rgba(0,0,0,0.7)',
                    }}
                >
                    Камер нээж байна...
                </div>
            )}

            {status === 'paused' && (
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(0,0,0,0.65)',
                        gap: 12,
                    }}
                >
                    <span style={{ color: '#fff', fontSize: 16 }}>QR уншлаа</span>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleRescan(); }}
                        style={{
                            backgroundColor: '#3498db',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 8,
                            padding: '12px 24px',
                            fontSize: 16,
                            fontWeight: 'bold',
                            cursor: 'pointer',
                        }}
                    >
                        Дахин унших
                    </button>
                </div>
            )}
        </div>
    );
}
