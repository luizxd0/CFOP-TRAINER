import type { FixtureSession } from '../fixtures';
export type NotifySink = (data: DataView) => void;
export declare class TrafficReplayer {
    private readonly fixture;
    private readonly traffic;
    private i;
    private readonly notifySinks;
    private readonly pendingNotifies;
    private readonly maxAutoFlushNotifies;
    constructor(fixture: FixtureSession, opts?: {
        maxAutoFlushNotifies?: number;
    });
    /** Test-only introspection for asserting replay progress. */
    debugCursor(): {
        index: number;
        length: number;
    };
    registerNotifySink(serviceUuid: string, characteristicUuid: string, sink: NotifySink): void;
    unregisterNotifySink(serviceUuid: string, characteristicUuid: string): void;
    private emitNotify;
    /**
     * Consume fixture traffic until a matching entry is found.
     * Any `notify` entries encountered along the way are delivered (or queued).
     */
    private consumeUntilMatch;
    onRead(serviceUuid: string, characteristicUuid: string): DataView;
    onWrite(serviceUuid: string, characteristicUuid: string, value: DataView): void;
    /**
     * Some protocol code performs discovery with varying redundancy. We keep discovery loose:
     * it can happen with or without matching fixture entries.
     */
    noteDiscovery(): void;
    /**
     * Deliver all remaining `notify` entries in the fixture, in order.
     * Useful after a successful connect when the real cube would keep streaming notifications.
     */
    drainNotifications(): void;
    /**
     * Like `drainNotifications()` but yields periodically to keep tests responsive.
     */
    drainNotificationsAsync(opts?: {
        chunkSize?: number;
    }): Promise<void>;
    private flushNotifiesUntilNextIo;
}
//# sourceMappingURL=traffic-replayer.d.ts.map