export declare function getCachedMacForDevice(device: BluetoothDevice): string | null;
export declare function setCachedMacForDevice(device: BluetoothDevice, mac: string): void;
export declare function removeCachedMacForDevice(device: BluetoothDevice): void;
/**
 * Wait for manufacturer data from advertisements (single shared listener).
 * Merges all packets until timeout: the first BLE advertisement often has an empty
 * manufacturerData map; MAC-bearing data appears on later frames.
 */
export declare function waitForManufacturerData(device: BluetoothDevice, timeoutMs?: number): Promise<BluetoothManufacturerData | null>;
/** GAN-style MAC from manufacturer data (last 6 bytes, reversed order in payload). */
export declare function macFromGanManufacturerData(mf: BluetoothManufacturerData | DataView): string | null;
//# sourceMappingURL=address-hints.d.ts.map