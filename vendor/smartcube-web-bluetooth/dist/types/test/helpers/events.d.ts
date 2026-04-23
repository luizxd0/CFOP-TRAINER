import type { SmartCubeEvent, SmartCubeCommand, SmartCubeConnection } from '../../smartcube/types';
export type NormalizedEvent = {
    type: 'MOVE';
    face: number;
    direction: number;
    move: string;
    cubeTimestamp: number | null;
} | {
    type: 'FACELETS';
    facelets: string;
} | {
    type: 'GYRO';
    quaternion: {
        x: number;
        y: number;
        z: number;
        w: number;
    };
} | {
    type: 'BATTERY';
    batteryLevel: number;
} | {
    type: 'HARDWARE';
    hardwareName?: string;
    softwareVersion?: string;
    hardwareVersion?: string;
    productDate?: string;
    gyroSupported?: boolean;
} | {
    type: 'DISCONNECT';
};
export declare function normalizeEvent(e: SmartCubeEvent): NormalizedEvent;
export declare function collectEvents(conn: SmartCubeConnection): {
    events: SmartCubeEvent[];
    unsubscribe: () => void;
};
export declare function moves(events: SmartCubeEvent[]): string[];
export declare function lastFacelets(events: SmartCubeEvent[]): string | null;
export declare function fixtureExpectedMoves(fixture: {
    events: {
        event: any;
    }[];
}, limit?: number): string[];
export declare function fixtureExpectedLastFacelets(fixture: {
    events: {
        event: any;
    }[];
}): string | null;
export declare function sendAllSupportedCommands(conn: SmartCubeConnection, commands: SmartCubeCommand[]): Promise<void>;
//# sourceMappingURL=events.d.ts.map