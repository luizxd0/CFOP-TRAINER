import type { FixtureSession } from '../fixtures';
import { TrafficReplayer } from './traffic-replayer';
export type MockBluetoothInstallResult = {
    device: BluetoothDevice;
    replayer: TrafficReplayer;
};
/**
 * Installs a mock `navigator.bluetooth.requestDevice` that returns a fake device whose
 * GATT services/characteristics are derived from fixture `discover-*` traffic entries.
 */
export declare function installMockBluetoothFromFixture(fixture: FixtureSession, opts?: {
    deviceId?: string;
    maxAutoFlushNotifies?: number;
}): MockBluetoothInstallResult;
//# sourceMappingURL=mock-bluetooth.d.ts.map