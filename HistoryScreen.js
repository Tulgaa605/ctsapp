import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
    StyleSheet, Text, View, SectionList,
    SafeAreaView, TouchableOpacity,
    Alert, ActivityIndicator, TextInput, Animated, Platform
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Device from 'expo-device';
import { loadHistory, deleteHistoryItems, deleteAllHistory } from './lib/historyStorage';
import { CTS_ASSET_TAG, sendAssetAll } from './lib/ctsystemApi';

export default function HistoryScreen({ selectedDate, setTotalCount }) {
    const [history, setHistory] = useState([]);
    const [listSections, setListSections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);
    const [selectedItems, setSelectedItems] = useState(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [zoomedItem, setZoomedItem] = useState(null);
    const [scaleAnim] = useState(new Animated.Value(0));
    const [opacityAnim] = useState(new Animated.Value(0));
    const isSelectionMode = selectedItems.size > 0;

    const fetchHistory = useCallback(async () => {
        const parsed = await loadHistory();
        setHistory(parsed);
    }, []);

    useFocusEffect(useCallback(() => {
        setLoading(true);
        fetchHistory().finally(() => setLoading(false));
    }, [fetchHistory]));

    const filteredHistory = useMemo(() => {
        if (!searchQuery) return history;
        const q = searchQuery.toLowerCase();
        return history.filter(item =>
            item.assetCode?.toLowerCase().includes(q) ||
            item.assetName?.toLowerCase().includes(q) ||
            item.handler?.toLowerCase().includes(q)
        );
    }, [history, searchQuery]);

    // --- ХАЙЛТ + СОНГОСОН САР ---
    const monthFiltered = useMemo(() => {
        const y = selectedDate.getFullYear();
        const m = selectedDate.getMonth() + 1;
        return filteredHistory.filter(item => item.year === y && item.month === m);
    }, [filteredHistory, selectedDate]);

    // === Grouping by selected month, then day ===
    useEffect(() => {
        setIsProcessing(true);
        const timer = setTimeout(() => {
            const grouped = {};
            monthFiltered.forEach(item => {
                const key = new Date(item.createdAt).toISOString().split('T')[0];
                if (!grouped[key]) {
                    grouped[key] = {
                        title: new Date(item.createdAt).toLocaleDateString('mn-MN', {
                            weekday: 'long', year: 'numeric', month: 'numeric', day: 'numeric'
                        }),
                        data: []
                    };
                }
                grouped[key].data.push(item);
            });
            const newSections = Object.keys(grouped)
                .sort((a, b) => b.localeCompare(a))
                .map(key => grouped[key]);
            setListSections(newSections);
            setIsProcessing(false);
        }, 50);
        return () => clearTimeout(timer);
    }, [monthFiltered]);

    // 👉 Header дээр “Бүгд: X”
    useEffect(() => {
        setTotalCount?.(monthFiltered.length);
        return () => setTotalCount?.(null);
    }, [monthFiltered.length, setTotalCount]);

    const handleSelect = (itemId) => {
        const ns = new Set(selectedItems);
        ns.has(itemId) ? ns.delete(itemId) : ns.add(itemId);
        setSelectedItems(ns);
    };

    const handleDeleteSelected = async () => {
        if (selectedItems.size === 0) return;
        Alert.alert(
            "Устгах уу?",
            `${selectedItems.size} мэдээлэл устгахдаа итгэлтэй байна уу?`,
            [
                { text: "Болих", style: "cancel" },
                {
                    text: "Устгах", style: "destructive",
                    onPress: async () => {
                        const newHistory = await deleteHistoryItems([...selectedItems]);
                        setHistory(newHistory);
                        setSelectedItems(new Set());
                    }
                }
            ]
        );
    };

    const handleDeleteAll = async () => {
        Alert.alert(
            "Анхаар!",
            "Та бүх түүхийг устгахдаа итгэлтэй байна уу? Энэ үйлдлийг буцаах боломжгүй.",
            [
                { text: "Болих", style: "cancel" },
                {
                    text: "Бүгдийг устгах", style: "destructive",
                    onPress: async () => {
                        await deleteAllHistory();
                        setHistory([]);
                        setSelectedItems(new Set());
                        Alert.alert("Амжилттай", "Бүх түүхийг устгалаа.");
                    }
                }
            ]
        );
    };
// 1) Helpers (файлын дээд талд нэг удаа байрлуул)
    const looksLikeDownloads = (uri) => {
        try {
            const u = decodeURIComponent(uri || '');
            if (/(^|[/:])(Download|Downloads)(\/|$)/i.test(u)) return true;
        } catch {}
        return (uri || '').includes('primary%3ADownload') || (uri || '').includes('Downloads');
    };

    const confirmAsync = (title, message) =>
        new Promise((resolve) => {
            Alert.alert(title, message, [
                { text: 'Choose another folder', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Save anyway', onPress: () => resolve(true) },
            ]);
        });



// 2) saveJsonToAndroidFolder-г бүхэлд нь энэ хувилбараар соли
    const saveJsonToAndroidFolder = async (jsonObj, filename) => {
        try {
            while (true) {
                // SAF picker-ийг нээж фолдер сонгуулна
                const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
                if (!perm.granted) {
                    Alert.alert('Cancelled', 'No folder selected.');
                    return false; // picker-ээ хаасан → гарна
                }

                const dirUri = perm.directoryUri;

                // Хэрэв Downloads бол анхааруулаад шийдвэр гаргуулна
                if (looksLikeDownloads(dirUri)) {
                    const proceed = await confirmAsync(
                        'Heads up',
                        'Downloads хавтас руу шууд хадгалах нь зарим төхөөрөмж дээр алдаа гаргаж болзошгүй.\n' +
                        'Хэрэв алдаа гарвал өөр хавтас сонгоно уу.\n\nProceed anyway?'
                    );
                    if (!proceed) {
                        // "Choose another folder" → picker-ээ ДАХИН нээнэ (loop үргэлжилнэ)
                        continue;
                    }
                }

                // Эндээс файл үүсгээд бичнэ
                const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
                    dirUri,
                    filename,
                    'application/json'
                );
                await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(jsonObj, null, 2), {
                    encoding: FileSystem.EncodingType.UTF8,
                });

                Alert.alert('Saved', `Saved to selected folder as ${filename}`);
                return true;
            }
        } catch (e) {
            Alert.alert('Save error', String(e?.message || e));
            return false;
        }
    };



    // ---------- COMMON: Send/Export хоёуланд ижил payload ----------
    const buildPayload = () => {
        const year = selectedDate.getFullYear();
        const month = selectedDate.getMonth() + 1;
        const key = CTS_ASSET_TAG;
        const deviceID = Device.osInternalBuildId || "UNKNOWN";

        // orgCode — тухайн сард уншсан бичлэгүүд бүгд ижил байгууллага гэж үзнэ
        let orgCode = "";
        if (monthFiltered[0]) {
            const first = monthFiltered[0];
            if (first.orgCode) {
                orgCode = first.orgCode;
            } else if (first.raw) {
                const p = first.raw.split("^?");
                orgCode = p[5] ?? "";
            }
        }

        const details = monthFiltered.map(item => {
            const parts = item.raw?.split("^?") || [];

            // QR огноо → YYYY-MM-DD
            let ognoo = "";
            if (item.date) {
                const d = new Date(item.date);
                if (!isNaN(d)) {
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, "0");
                    const day = String(d.getDate()).padStart(2, "0");
                    ognoo = `${y}-${m}-${day}`;
                } else {
                    ognoo = String(item.date);
                }
            }

            // price → 2 орны нарийвчлалтай STRING (e.g. "42857.80")
            const numPrice = Number(item.unitPrice ?? item.price ?? 0);
            const price = Number.isFinite(numPrice) ? numPrice.toFixed(2) : "0.00";

            return {
                lordID: item.lordID ?? parts[0] ?? "",
                account: (item.account ? item.account.split("-")[0].trim() : ""),
                code: item.assetCode ?? item.code ?? "",
                price, // string with two decimals
                serial: parseInt(String(item.serialNumber ?? item.serial), 10) || 0,
                deviceID: item.deviceId ?? item.deviceID ?? deviceID,
                ognoo,
                scanDate: item.createdAt ?? item.ScannedDate ?? new Date().toISOString()
            };
        });

        return { year, month, key, orgCode, details };
    };

    // --- EXPORT (iOS share / Android SAF) ---
    const handleExportFilteredJson = async () => {
        if (monthFiltered.length === 0) {
            Alert.alert("Анхаар!", "Экспортлох өгөгдөл алга (сонгосон сард хайлтын үр дүн байхгүй).");
            return;
        }

        const payload = buildPayload();
        const filename = `qr_filtered_export_${Date.now()}.json`;

        if (Platform.OS === 'android') {
            const ok = await saveJsonToAndroidFolder(payload, filename);
            if (ok) return; // амжилттай хадгалсан
            // cancel хийвэл share fallback руу уная
        }

        try {
            const fileUri = FileSystem.documentDirectory + filename;
            await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(payload, null, 2), {
                encoding: FileSystem.EncodingType.UTF8
            });
            const canShare = await Sharing.isAvailableAsync();
            if (canShare) {
                await Sharing.shareAsync(fileUri);
            } else {
                Alert.alert('Saved (app storage)', `File saved at:\n${fileUri}`);
            }
        } catch (error) {
            console.error("Export error:", error);
            Alert.alert("Алдаа", "Экспортлох үед алдаа гарлаа.");
        }
    };

    // --- SEND (payload-той адил формат) ---
    const handleSendFilteredJson = async () => {
        if (monthFiltered.length === 0) {
            Alert.alert("Анхаар!", "Илгээх өгөгдөл алга (сонгосон сард хайлтын үр дүн байхгүй).");
            return;
        }

        const payload = buildPayload();

        // Log
        console.log("=== JSON SENDING TO API ===");
        console.log(JSON.stringify(payload, null, 2));

        try {
            const result = await sendAssetAll(payload);
            Alert.alert("Илгээлээ", `${result.count} бичлэгийг ctsystem.mn/CT$FS4 руу амжилттай илгээлээ.`);
        } catch (e) {
            Alert.alert("Алдаа", `Илгээх үед алдаа гарлаа:\n${String(e?.message || e)}`);
        }
    };

    const handleZoomItem = (item) => {
        setZoomedItem(item);
        Animated.parallel([
            Animated.timing(scaleAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
            Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true })
        ]).start();
    };

    const closeZoomItem = () => {
        Animated.parallel([
            Animated.timing(scaleAnim, { toValue: 0.8, duration: 150, useNativeDriver: true }),
            Animated.timing(opacityAnim, { toValue: 0, duration: 150, useNativeDriver: true })
        ]).start(() => setZoomedItem(null));
    };

    if (loading) {
        return <View style={styles.centered}><ActivityIndicator size="large" /></View>;
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.controlsContainer}>
                {isSelectionMode ? (
                    <View style={styles.selectionHeader}>
                        <TouchableOpacity onPress={() => setSelectedItems(new Set())}>
                            <Text style={styles.headerButton}>Цуцлах</Text>
                        </TouchableOpacity>
                        <Text style={styles.title}>{selectedItems.size} сонгогдсон</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <TouchableOpacity onPress={handleDeleteSelected}>
                                <MaterialCommunityIcons name="delete" size={24} color="#ef4444" />
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : (
                    <View style={styles.searchRow}>
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Хайх..."
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                        />
                        {/* Send */}
                        <TouchableOpacity onPress={handleSendFilteredJson} style={{ padding: 8, marginLeft: 8 }}>
                            <MaterialCommunityIcons name="send" size={24} color="#2563eb" />
                        </TouchableOpacity>
                        {/* Export */}
                        <TouchableOpacity onPress={handleExportFilteredJson} style={{ padding: 8, marginLeft: 7 }}>
                            <MaterialCommunityIcons name="tray-arrow-down" size={24} color="#10b981" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleDeleteAll} style={styles.deleteAllButton}>
                            <MaterialCommunityIcons name="delete-sweep" size={24} color="#ef4444" />
                        </TouchableOpacity>
                    </View>
                )}
            </View>

            {isProcessing ? (
                <View style={styles.centered}><ActivityIndicator size="large" /></View>
            ) : listSections.length === 0 ? (
                <View style={styles.centered}><Text style={styles.emptyText}>Сонгосон сард түүх алга.</Text></View>
            ) : (
                <SectionList
                    sections={listSections}
                    keyExtractor={(item, index) => item.id || `item-${index}`}
                    renderItem={({ item }) => (
                        <ListItem
                            item={item}
                            isSelectionMode={isSelectionMode}
                            selectedItems={selectedItems}
                            onSelect={handleSelect}
                            onLongPress={handleZoomItem}
                        />
                    )}
                    renderSectionHeader={({ section: { title } }) => (
                        <Text style={styles.sectionHeader}>{title}</Text>
                    )}
                    ListFooterComponent={<View style={{ height: 20 }} />}
                />
            )}

            {zoomedItem && (
                <Animated.View style={[styles.zoomOverlay, { opacity: opacityAnim }]}>
                    <Animated.View style={[styles.zoomBox, { transform: [{ scale: scaleAnim }] }]}>
                        <Text style={styles.zoomTitle}>Хөрөнгийн дэлгэрэнгүй</Text>
                        <Text style={styles.zoomText}>Код: {zoomedItem.assetCode}</Text>
                        <Text style={styles.zoomText}>Нэр: {zoomedItem.assetName || '—'}</Text>
                        <Text style={styles.zoomText}>Үнэ: {Number(zoomedItem.unitPrice || 0).toLocaleString()} ₮</Text>
                        <Text style={styles.zoomText}>Хэмжих нэгж: {zoomedItem.unitType || '—'}</Text>
                        <Text style={styles.zoomText}>А.О. Огноо: {new Date(zoomedItem.date).toLocaleDateString('mn-MN')}</Text>
                        <Text style={styles.zoomText}>Эд хариуцагч: {zoomedItem.handler || '—'}</Text>
                        <TouchableOpacity onPress={closeZoomItem} style={styles.zoomCloseBtn}>
                            <Text style={styles.zoomCloseText}>Хаах</Text>
                        </TouchableOpacity>
                    </Animated.View>
                </Animated.View>
            )}
        </SafeAreaView>
    );
}

const ListItem = React.memo(({ item, isSelectionMode, selectedItems, onSelect, onLongPress }) => {
    const isSelected = selectedItems.has(item.id);
    return (
        <TouchableOpacity
            style={[styles.listItem, isSelected && styles.listItemSeletected]}
            onLongPress={() => !isSelectionMode && onLongPress(item)}
            onPress={() => { if (isSelectionMode) onSelect(item.id); }}
        >
            <View style={styles.listItemContent}>
                {isSelectionMode && (
                    <MaterialCommunityIcons
                        name={isSelected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                        size={24}
                        color={isSelected ? '#3b82f6' : '#888'}
                        style={{ marginRight: 15 }}
                    />
                )}
                <View style={{ flex: 1 }}>
                    <Text style={styles.itemText}>
                        {item.handler ? `Эд хариуцагч: ${item.handler}\n` : ''}
                        Хөрөнгийн код: {item.assetCode ?? '—'}{"\n"}
                        {item.assetName ? `Хөрөнгийн нэр: ${item.assetName}\n` : ''}
                        {item.unitType ? `Хэмжих нэгж: ${item.unitType}\n` : ""}
                        Нэгж үнэ: {item.unitPrice ? Number(item.unitPrice).toLocaleString('mn-MN') : '—'} ₮{"\n"}
                        Бүртгэлийн данс: {item.account ?? '—'}{"\n"}
                        А.О.Огноо: {(() => {
                        if (!item.date) return '—';
                        const d = new Date(item.date);
                        return isNaN(d) ? String(item.date) : d.toLocaleDateString('mn-MN');
                    })()}
                    </Text>
                    <Text style={styles.itemDate}>
                        {item.createdAt ? new Date(item.createdAt).toLocaleString('en-GB') : '—'}
                    </Text>
                </View>
            </View>
        </TouchableOpacity>
    );
});

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#f0f2f5' },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    emptyText: { fontSize: 18, color: '#555' },
    controlsContainer: { padding: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#ddd' },
    searchRow: { flexDirection: 'row', alignItems: 'center' },
    searchInput: { flex: 1, backgroundColor: '#f0f2f5', height: 40, borderRadius: 8, paddingHorizontal: 15, fontSize: 16 },
    deleteAllButton: { padding: 8, marginLeft: 8 },
    selectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 5, height: 40 },
    headerButton: { fontSize: 16, color: '#3b82f6', fontWeight: '500' },
    title: { fontSize: 16, fontWeight: 'bold' },
    sectionHeader: { padding: 10, fontSize: 14, fontWeight: 'bold', color: '#555', backgroundColor: '#f0f2f5' },
    listItem: { backgroundColor: 'white', borderRadius: 8, marginVertical: 5, marginHorizontal: 10, elevation: 1 },
    listItemSeletected: { backgroundColor: '#e0e7ff', borderColor: '#3b82f6', borderWidth: 1.5 },
    listItemContent: { flexDirection: 'row', alignItems: 'center', padding: 15 },
    itemText: { fontSize: 16, color: '#111827', lineHeight: 24 },
    itemDate: { fontSize: 12, color: '#888', marginTop: 8, textAlign: 'right' },
    zoomOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', zIndex: 999 },
    zoomBox: { backgroundColor: 'white', padding: 25, borderRadius: 16, width: '90%', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 10 },
    zoomTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
    zoomText: { fontSize: 16, marginBottom: 10, lineHeight: 22 },
    zoomCloseBtn: { marginTop: 20, alignSelf: 'center', backgroundColor: '#3b82f6', paddingVertical: 10, paddingHorizontal: 30, borderRadius: 8 },
    zoomCloseText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
});
