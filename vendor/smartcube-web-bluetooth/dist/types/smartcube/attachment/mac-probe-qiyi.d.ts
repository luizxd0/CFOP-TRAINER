/**
 * Returns true if notifications decrypt to plausible QiYi payloads for this MAC.
 */
export declare function probeQiYiMac(device: BluetoothDevice, mac: string, options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<boolean>;
//# sourceMappingURL=mac-probe-qiyi.d.ts.map