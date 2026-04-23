/**
 * Connect GATT (if needed) and return normalized primary service UUIDs.
 * Uses a connect timeout and limited retries on transient failures.
 */
export declare function collectPrimaryServiceUuids(device: BluetoothDevice): Promise<ReadonlySet<string>>;
//# sourceMappingURL=gatt-snapshot.d.ts.map