import { Subject } from 'rxjs';
import type { GanCubeCommand, GanCubeConnection, GanCubeEvent } from './gan-cube-protocol';
/**
 * GAN 356i “API v1”: primary service `fff0` + Device Information for key derivation.
 */
export declare class GanGen1CubeConnection implements GanCubeConnection {
    readonly deviceMAC = "";
    readonly events$: Subject<GanCubeEvent>;
    private readonly encrypter;
    private readonly device;
    private readonly chrState;
    private readonly chrMoves;
    private readonly chrFacelets;
    private readonly chrBattery;
    private readonly chrGyroNotify;
    private polling;
    private prevMoveCnt;
    private movePollTicks;
    private batteryPollTicks;
    private pollFailures;
    private teardown;
    private lastBatteryLevel;
    private forceNextBatteryEmission;
    private readonly onGattDisconnected;
    private constructor();
    get deviceName(): string;
    static create(device: BluetoothDevice): Promise<GanGen1CubeConnection>;
    private onGyroNotify;
    private emitBatteryLevel;
    private readBattery;
    private readInitialState;
    private schedulePoll;
    private pollLoop;
    private handleDisconnect;
    sendCubeCommand(command: GanCubeCommand): Promise<void>;
    disconnect(): Promise<void>;
}
//# sourceMappingURL=gan-gen1.d.ts.map