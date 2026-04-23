import { now } from '../utils';
declare function findCharacteristic(characteristics: BluetoothRemoteGATTCharacteristic[], uuid: string): BluetoothRemoteGATTCharacteristic | null;
declare function waitForAdvertisements(device: BluetoothDevice, timeoutMs?: number): Promise<BluetoothManufacturerData | null>;
declare function extractMacFromManufacturerData(mfData: BluetoothManufacturerData | DataView | null, cicList: number[], reversedByteOrder?: boolean): string | null;
export { now, findCharacteristic, waitForAdvertisements, extractMacFromManufacturerData };
//# sourceMappingURL=ble-utils.d.ts.map