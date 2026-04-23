/**
 * Returns true if notifications decrypt to plausible MoYu32 payloads for this MAC.
 */
export declare function probeMoyu32Mac(device: BluetoothDevice, mac: string, options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<boolean>;
//# sourceMappingURL=mac-probe-moyu32.d.ts.map