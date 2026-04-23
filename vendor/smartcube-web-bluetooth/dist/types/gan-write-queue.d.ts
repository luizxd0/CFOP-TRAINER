/**
 * Serializes GATT write operations (writeValueWithResponse / writeValueWithoutResponse) to avoid overlapping operations on some stacks.
 */
export declare class GattWriteQueue {
    private tail;
    enqueue<T>(fn: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=gan-write-queue.d.ts.map