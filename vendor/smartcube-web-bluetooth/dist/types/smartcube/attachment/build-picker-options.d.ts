import type { SmartCubeProtocol } from '../protocol';
import type { DeviceSelectionMode } from './types';
export interface BuildRequestDeviceOptionsExtras {
    deviceName?: string;
}
/**
 * Build Web Bluetooth `requestDevice` options for the given mode.
 * Manufacturer IDs appear in `filters` (OR with name filters) and in `optionalManufacturerData`
 * so `watchAdvertisements` exposes manufacturer data when the device matched by name prefix.
 */
export declare function buildRequestDeviceOptions(protocols: SmartCubeProtocol[], mode: DeviceSelectionMode, extras?: BuildRequestDeviceOptionsExtras): RequestDeviceOptions;
//# sourceMappingURL=build-picker-options.d.ts.map