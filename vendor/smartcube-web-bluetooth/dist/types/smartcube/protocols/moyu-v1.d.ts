declare const MOYU_V1_SOLVED_STICKERS: number[][];
export interface MoyuV1CubeStatePayload {
    readonly stickers: number[][];
    readonly angles: number[];
}
export declare function moyuV1ParseCubeStatePayload(t: DataView): MoyuV1CubeStatePayload;
export declare function moyuV1EncodeCubeStatePayload(stickers: number[][], angles: number[]): Uint8Array;
/** Build 54-char URFDLB facelet string for CubieCube.fromFacelet. */
export declare function moyuStickersToFaceletString(stickers: number[][]): string;
export interface MoyuV1HardwareInfo {
    readonly bootCount: number;
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
}
export interface MoyuV1BatteryInfo {
    readonly charging: boolean;
    readonly full: boolean;
    readonly percentage: number;
    readonly voltage: number;
}
export declare class MoyuV1Client {
    private readonly writeCharacteristic;
    private readonly idGen;
    private readonly sendCountGen;
    private incomplete;
    private waiters;
    constructor(writeCharacteristic: BluetoothRemoteGATTCharacteristic);
    /** Call from 0x1002 notification handler. */
    onReadNotification(dv: DataView): void;
    private headerByte;
    private sendRawRequest;
    send(command: number, payload?: Uint8Array): Promise<{
        sentAt: number;
        receivedAt: number;
        value: DataView;
    }>;
    getCubeState(): Promise<MoyuV1CubeStatePayload>;
    setCubeState(stickers?: number[][], angles?: number[]): Promise<void>;
    getBatteryInfo(): Promise<{
        sentAt: number;
        receivedAt: number;
        value: MoyuV1BatteryInfo;
    }>;
    getHardwareInfo(): Promise<MoyuV1HardwareInfo>;
    getTime(): Promise<{
        sentAt: number;
        receivedAt: number;
        value: {
            seconds: number;
            counter: number;
        };
    }>;
    setSleepState(state: number): Promise<void>;
}
export { MOYU_V1_SOLVED_STICKERS };
//# sourceMappingURL=moyu-v1.d.ts.map