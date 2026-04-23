import type { SmartCubeProtocol } from '../protocol';
/**
 * Pick the protocol that best matches the GATT profile. Tie-break with `matchesDevice` (name).
 */
export declare function resolveProtocolByGatt(protocols: readonly SmartCubeProtocol[], serviceUuids: ReadonlySet<string>, device: BluetoothDevice): SmartCubeProtocol | null;
//# sourceMappingURL=profile-rank.d.ts.map