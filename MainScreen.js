import React, { useState, useRef, useEffect } from 'react';
import {
    StyleSheet, Text, View, TouchableOpacity,
    ScrollView, Alert, ActivityIndicator, Vibration, Button, Platform
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useIsFocused } from '@react-navigation/native';
import { useNetInfo } from '@react-native-community/netinfo';
import { loadHistory, saveHistoryItem } from './lib/historyStorage';
import { fetchAssetDetails, sendAssetItem, isDeviceOnline } from './lib/ctsystemApi';
import CameraSection from './components/CameraSection';

const ALERT_COOLDOWN_MS = 1200;
const RESCAN_DELAY_MS = 1000; // давхар уншилтыг багасгахад тусална

export default function MainScreen({ selectedDate }) {
    const [infoText, setInfoText] = useState(null);
    const [loading, setLoading] = useState(false);
    const [permission, requestPermission] = useCameraPermissions();
    const [scanned, setScanned] = useState(false);
    const [precheck, setPrecheck] = useState({ level: 'idle', messages: [] });
    const scanLocked = useRef(false);
    const alertStampRef = useRef(0);
    const isFocused = useIsFocused();
    const { isConnected } = useNetInfo();
    const isOnline = isDeviceOnline(isConnected);

    // ---- Давхар тайм-аут цэвэрлэх төвлөрсөн unlock ----
    const rescanTimerRef = useRef(null);
    const unlockScanner = (delay = RESCAN_DELAY_MS) => {
        if (rescanTimerRef.current) {
            clearTimeout(rescanTimerRef.current);
            rescanTimerRef.current = null;
        }
        rescanTimerRef.current = setTimeout(() => {
            setScanned(false);
            scanLocked.current = false;
            rescanTimerRef.current = null;
        }, delay);
    };
    useEffect(() => {
        return () => {
            if (rescanTimerRef.current) {
                clearTimeout(rescanTimerRef.current);
                rescanTimerRef.current = null;
            }
        };
    }, []);

    // -------- Туслах функцууд --------
    const showOnceAlert = (title, message, onOk) => {
        const now = Date.now();
        if (now - alertStampRef.current < ALERT_COOLDOWN_MS) return;
        alertStampRef.current = now;
        if (Platform.OS === 'web') {
            window.alert(`${title}\n\n${message}`);
            onOk?.();
            return;
        }
        Alert.alert(title, message, [{ text: 'OK', onPress: onOk || (() => {}) }]);
    };

    const normalizeDate = (s) => {
        if (!s) return "";
        let t = String(s).trim();
        // yyyy.mm.dd / yyyy/mm/dd → yyyy-mm-dd
        t = t.replace(/[./]/g, "-");
        // yyyy-m-d / yyyy-mm-dd → сар/өдрийг 2 оронтой
        const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (m) {
            const [, y, mo, d] = m;
            const pad = (n) => String(n).padStart(2, "0");
            return `${y}-${pad(mo)}-${pad(d)}`;
        }
        // yyyyMMdd → yyyy-mm-dd
        const m2 = t.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
        return t;
    };

    const loadNormalizedHistory = async () => loadHistory();

    // ---- Зөвхөн НЭГ алдаа буцаадаг урьдчилсан шалгалт ----
    const runPrecheck = (parsed, selectedDate, history, isConnected) => {
        // 1) Байгууллагын код зөрчил (хамгийн түрүүнд)
        const existingOrgs = new Set(history.map(it => it.orgCode).filter(Boolean));
        if (existingOrgs.size > 0) {
            const firstOrg = Array.from(existingOrgs)[0];
            if (parsed.orgCode && parsed.orgCode !== firstOrg) {
                return {
                    level: 'error',
                    messages: ['Өөр байгууллагын хөрөнгө байна. Хуучин түүхтэй зөрчилдөж байна. Хуучин түүхээ устгаад шинэ тооллого эхлүүлнэ үү.']
                };
            }
        }

        // 2) Давхцал (assetCode + serialNumber)
        const isDup = history.some(
            it => it.assetCode === parsed.assetCode && it.serialNumber === parsed.serialNumber
        );
        if (isDup) {
            return {
                level: 'error',
                messages: ['Энэ хөрөнгө аль хэдийн хадгалагдсан байна (давхцал).']
            };
        }

        // 3) Хадгалсан түүхийн он/сар ↔ сонгосон он/сар
        const ymKey = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
        const selectedYM = ymKey(selectedDate.getFullYear(), selectedDate.getMonth() + 1);
        const historyYMSet = new Set(
            history.filter(it => it.year && it.month).map(it => ymKey(it.year, it.month))
        );
        const hasDifferentMonth = [...historyYMSet].some(ym => ym !== selectedYM);
        if (hasDifferentMonth) {
            return {
                level: 'error',
                messages: [
                    `Хадгалсан түүх ${[...historyYMSet].join(', ')} сард байна. ` +
                    `Харин сонгосон сар ${selectedYM}. Зөрчилтэй тул тохирох сар руу шилжих эсвэл түүхээ цэвэрлэнэ үү.`
                ]
            };
        }

        // --- WARN/OK нэгтгэнэ ---
        const messages = [];
        let level = 'ok';

        if (parsed.assetName === '[интернет шаардлагатай]' || parsed.assetName === '[дэлгэрэнгүй олдсонгүй]' || parsed.assetName === '[оффлайн хадгалсан]') {
            level = 'warn';
            messages.push('Дэлгэрэнгүй мэдээлэл татагдаагүй (сервер олдсонгүй эсвэл QR баазад байхгүй).');
        }
        if (!isOnline) {
            level = 'warn';
            messages.push('Оффлайн горим: зөвхөн төхөөрөмж дээр хадгална. Дараа нь синк хийж болно.');
        }

        if (messages.length === 0) messages.push('Бэлэн байна. Хадгалж болно ✅');
        return { level, messages };
    };

    // -------- QR уншилт --------
    const handleBarCodeScanned = async (result) => {
        if (!isFocused) return;
        if (scanned || scanLocked.current) return;

        const data = typeof result === 'string'
            ? result
            : (result?.data ?? result?.nativeEvent?.data);
        if (!data) return;

        // lock & vibrate
        scanLocked.current = true;
        setScanned(true);
        if (Platform.OS !== 'web') Vibration.vibrate();

        try {
            const parts = (data || '').split('^?');
            if (parts.length !== 7 && parts.length !== 9) {
                showOnceAlert('QR формат алдаатай', 'QR кодын өгөгдөл дутуу эсвэл илүү байна.', () => unlockScanner());
                return;
            }

            // 6 дахь талбар = байгууллагын код
            const orgCode = parts[5] || '';

            const parsed = {
                lordID: parts[0] || '',
                account: parts[1] || '',
                assetCode: parts[2] || '',
                unitPrice: parts[3] || '',
                date: normalizeDate(parts[4] || ''),
                serialNumber: parts[6] || '',
                orgCode,
                raw: data,
                handler: '',
                assetName: '',
                unitType: '',
            };

            // 9 талбар → нэр/эс хариуцагч шууд
            if (parts.length === 9) {
                parsed.handler = parts[7] || '';
                parsed.assetName = parts[8] || '';
            } else {
                // 7 талбар → зөвхөн онлайнаар details авах
                const year = selectedDate.getFullYear();
                const month = selectedDate.getMonth() + 1;
                const deviceId = Device.osInternalBuildId || 'WEB';
                let item = null;
                if (isOnline) {
                    setInfoText({ ...parsed, assetName: 'Дэлгэрэнгүй татаж байна...' });
                    try {
                        item = await fetchAssetDetails({ raw: data, year, month, deviceId });
                    } catch (err) {
                        console.warn('fetchAssetDetails failed:', err);
                        showOnceAlert('Сервер алдаа', 'Дэлгэрэнгүй татаж чадсангүй. Хадгалж болно.');
                    }
                } else {
                    showOnceAlert('Оффлайн горим', 'Интернетгүй тул дэлгэрэнгүй авахгүй. Хадгалж болно.');
                }

                if (item) {
                    parsed.assetName = item.name || parsed.assetName;
                    parsed.unitType = item.unt || parsed.unitType;
                    parsed.handler = item.lord || parsed.handler;
                    parsed.date = normalizeDate(item.ognoo || parsed.date);
                    parsed.account = item.dans || parsed.account;
                    parsed.unitPrice = item.une != null ? String(item.une) : parsed.unitPrice;
                } else if (isOnline && !parsed.assetName) {
                    parsed.assetName = '[дэлгэрэнгүй олдсонгүй]';
                }
            }

            // ---------- Урьдчилсан шалгалт ----------
            const hist = await loadNormalizedHistory();
            const result = runPrecheck(parsed, selectedDate, hist, isOnline);
            setPrecheck(result);

            if (result.level === 'error') {
                // Алдаа бол "Мэдээлэл" хэсэгт data-г үзүүлэхгүй
                setInfoText(null);
                showOnceAlert('Алдаа', result.messages[0], () => unlockScanner());
                return;
            }

            // OK/WARN үед мэдээллээ харуулна
            setInfoText(parsed);

            if (result.level === 'warn') {
                showOnceAlert('Анхааруулга', result.messages.join('\n'));
            }

            // Амжилттай үед lock суллана (Rescan товчоор дахин унших боломжтой)
            scanLocked.current = false;

        } catch (e) {
            showOnceAlert('Алдаа', 'Унших үед алдаа гарлаа. Дахин оролдоно уу.', () => unlockScanner());
        }
    };

    // -------- Хадгалах --------
    const saveData = async () => {
        if (!infoText || !infoText.raw) {
            showOnceAlert('Хоосон мэдээлэл', 'Хадгалах мэдээлэл олдсонгүй.');
            return;
        }
        if (precheck.level === 'error') {
            showOnceAlert('Хадгалах боломжгүй', precheck.messages[0] || 'Алдаа байна.');
            return;
        }

        setLoading(true);
        try {
            const deviceId = Device.osInternalBuildId || 'UNKNOWN';
            const year = selectedDate.getFullYear();
            const month = selectedDate.getMonth() + 1;

            const normalizedHistory = await loadHistory();

            // байгууллагын кодын хамгаалалт
            const existingOrgCodes = new Set(normalizedHistory.map(it => it.orgCode).filter(Boolean));
            if (existingOrgCodes.size > 0) {
                const firstOrg = Array.from(existingOrgCodes)[0];
                if (infoText.orgCode && infoText.orgCode !== firstOrg) {
                    showOnceAlert(
                        'Өөр байгууллагын хөрөнгө',
                        'Хуучин түүхтэй зөрчилдөж байна. Хуучин түүхээ устгаад шинэ тооллого эхлүүлнэ үү.'
                    );
                    setLoading(false);
                    return;
                }
            }

            // давхцал
            if (normalizedHistory.some(it =>
                it.assetCode === infoText.assetCode && it.serialNumber === infoText.serialNumber
            )) {
                showOnceAlert('Давхцал', 'Энэ хөрөнгө аль хэдийн хадгалагдсан байна.');
                setLoading(false);
                return;
            }

            const newItem = {
                ...infoText,
                deviceId,
                year,
                month,
                createdAt: new Date().toISOString(),
            };

            let ctsOk = false;
            let ctsWarning = null;

            if (isOnline) {
                try {
                    const ctsResult = await sendAssetItem(newItem);
                    ctsOk = true;
                    console.log('CTS asset result:', ctsResult);
                } catch (error) {
                    ctsWarning = error?.message || 'ctsystem.mn руу илгээж чадсангүй';
                    console.warn('CTS save failed:', ctsWarning);
                }
            }

            let savedToDb = false;
            try {
                const saveResult = await saveHistoryItem(newItem);
                savedToDb = saveResult.savedToDb;
            } catch (error) {
                if (error?.code === 'DUPLICATE') {
                    showOnceAlert('Давхцал', 'Энэ хөрөнгө аль хэдийн хадгалагдсан байна.');
                    setLoading(false);
                    return;
                }
                throw error;
            }

            const parts = [];
            if (savedToDb) parts.push('Өгөгдлийн санд хадгаллаа');
            else parts.push('Серверт холбогдож чадсангүй — зөвхөн төхөөрөмж дээр түр хадгаллаа');

            if (isOnline) {
                if (ctsOk) parts.push('ctsystem.mn/CT$FS4 руу илгээлээ');
                else parts.push(`ctsystem.mn илгээлт амжилтгүй: ${ctsWarning}`);
            }

            const allOk = savedToDb && (!isOnline || ctsOk);
            const title = allOk ? 'Амжилттай' : 'Хэсэгчлэн амжилттай';
            const msg = parts.join('.\n');
            if (Platform.OS === 'web') {
                window.alert(`${title}\n${msg}`);
            } else {
                Alert.alert(title, msg);
            }
            setInfoText(null);
            setScanned(false);
            setPrecheck({ level: 'idle', messages: [] });
        } catch (e) {
            const message = e?.message || 'Мэдээллийг хадгалах үед алдаа гарлаа.';
            showOnceAlert('Алдаа', message);
        } finally {
            setLoading(false);
        }
    };

    const cameraActive = Boolean(permission?.granted && isFocused && !scanned);

    const handleRescan = () => {
        setInfoText(null);
        setPrecheck({ level: 'idle', messages: [] });
        unlockScanner(0);
    };

    if (Platform.OS !== 'web') {
        if (!permission) return <View />;
        if (!permission.granted) {
            return (
                <View style={styles.centerText}>
                    <Text style={{ textAlign: 'center', marginBottom: 10 }}>Камер ашиглах зөвшөөрөл олгоно уу.</Text>
                    <Button onPress={requestPermission} title="Зөвшөөрөл олгох" />
                </View>
            );
        }
    }

    return (
        <ScrollView contentContainerStyle={styles.container}>
            {Platform.OS === 'web' ? (
                <View style={styles.webCameraWrap}>
                    <CameraSection
                        onScan={handleBarCodeScanned}
                        scanPaused={scanned || !isFocused}
                        onRescanRequest={handleRescan}
                    />
                </View>
            ) : (
                <View style={styles.cameraContainer}>
                    {cameraActive && (
                        <CameraView
                            onBarcodeScanned={handleBarCodeScanned}
                            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                            facing="back"
                            style={StyleSheet.absoluteFillObject}
                        />
                    )}
                    {!cameraActive && (
                        <View style={styles.cameraPlaceholder}>
                            <MaterialCommunityIcons name="camera-off" size={36} color="#fff" />
                            <Text style={styles.cameraPlaceholderText}>Камер ачааллаж байна...</Text>
                        </View>
                    )}
                    {scanned && (
                        <TouchableOpacity style={styles.rescanButton} onPress={handleRescan}>
                            <MaterialCommunityIcons name="qrcode-scan" size={40} color="#fff" />
                            <Text style={styles.rescanButtonText}>Дахин унших</Text>
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {!isOnline && (
                <View style={styles.offlineBanner}>
                    <Text style={styles.offlineText}>Оффлайн горим: өгөгдөл төхөөрөмж дээр хадгалагдана.</Text>
                </View>
            )}

            <TouchableOpacity style={styles.saveButton} onPress={saveData} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Хадгалах</Text>}
            </TouchableOpacity>

            <View style={styles.infoBox}>
                <Text style={styles.infoTitle}>Мэдээлэл</Text>
                {infoText ? (
                    <Text style={styles.infoFormatted}>
                        Эд хариуцагч: {infoText.handler || ' '}{"\n"}
                        Хөрөнгийн код: {infoText.assetCode || ' '}{"\n"}
                        Хөрөнгийн нэр: {infoText.assetName || ' '}{"\n"}
                        {infoText.unitType ? `Хэмжих нэгж: ${infoText.unitType}\n` : ''}
                        Нэгж үнэ: {Number(infoText.unitPrice || 0).toLocaleString('mn-MN')} ₮{"\n"}
                        Бүртгэлийн данс: {infoText.account || ' '}{"\n"}
                        А.О.Огноо: {infoText.date || ' '}{"\n"}
                        Байгууллагын код: {infoText.orgCode || ' '}
                    </Text>
                ) : (
                    <Text style={styles.placeholderText}>QR уншуулсан мэдээлэл энд харагдана.</Text>
                )}

                {precheck.level !== 'idle' && (
                    <View style={[
                        styles.checkPanel,
                        precheck.level === 'ok' && styles.okPanel,
                        precheck.level === 'warn' && styles.warnPanel,
                        precheck.level === 'error' && styles.errorPanel
                    ]}>
                        {precheck.messages.map((m, i) => (
                            <Text
                                key={i}
                                style={[
                                    styles.checkText,
                                    precheck.level === 'ok' && styles.okText,
                                    precheck.level === 'warn' && styles.warnText,
                                    precheck.level === 'error' && styles.errorText
                                ]}
                            >
                                • {m}
                            </Text>
                        ))}
                    </View>
                )}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flexGrow: 1, alignItems: 'center', padding: 20, backgroundColor: '#f0f2f5' },
    webCameraWrap: { width: '100%', alignItems: 'center' },
    cameraContainer: { width: 250, height: 250, overflow: 'hidden', borderRadius: 10, borderWidth: 3, borderColor: '#5dade2', marginBottom: 30, backgroundColor: '#000' },
    cameraPlaceholder: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 16 },
    cameraPlaceholderText: { color: '#fff', textAlign: 'center', marginTop: 8, fontSize: 13 },
    saveButton: { backgroundColor: '#34d399', paddingVertical: 15, borderRadius: 10, alignItems: 'center', justifyContent: 'center', width: '100%', marginBottom: 20 },
    buttonText: { color: '#ffffff', fontSize: 16, fontWeight: 'bold' },
    rescanButton: { backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%' },
    rescanButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginTop: 10 },
    centerText: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
    infoBox: { width: '100%', borderColor: '#5dade2', borderWidth: 2, borderRadius: 10, padding: 15, backgroundColor: '#ffffff', marginBottom: 20, flex: 1 },
    infoTitle: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 10, color: '#333' },
    infoFormatted: { fontSize: 16, color: '#333', lineHeight: 26 },
    placeholderText: { color: '#999', fontStyle: 'italic' },

    offlineBanner: { width: '100%', backgroundColor: '#fff7ed', borderColor: '#f59e0b', borderWidth: 1, padding: 10, borderRadius: 8, marginBottom: 12 },
    offlineText: { color: '#92400e' },

    checkPanel: { padding: 10, borderRadius: 8, marginTop: 12, borderWidth: 1 },
    okPanel: { backgroundColor: '#e6fffa', borderColor: '#14b8a6' },
    warnPanel: { backgroundColor: '#fff7ed', borderColor: '#f59e0b' },
    errorPanel: { backgroundColor: '#fee2e2', borderColor: '#ef4444' },

    checkText: { fontSize: 14, marginBottom: 4 },
    okText: { color: '#047857' },
    warnText: { color: '#92400e' },
    errorText: { color: '#991b1b' },
});
