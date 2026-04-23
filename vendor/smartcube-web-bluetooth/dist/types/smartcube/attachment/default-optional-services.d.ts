/**
 * Consolidated GATT service UUIDs for pairing so the OS grants access across vendors.
 */
export declare const DEVICE_INFORMATION_SERVICE: string;
export declare const GENERIC_ACCESS_SERVICE: string;
/** QiYi primary (16-bit FFF0). */
export declare const QIYI_LIKE_FFF0: string;
/** MoYu plain (MHC). */
export declare const MOYU_PLAIN_SERVICE: string;
/** MoYu32 / WCU. */
export declare const MOYU32_SERVICE = "0783b03e-7735-b5a0-1760-a305d2795cb0";
/** Giiker. */
export declare const GIIKER_DATA_SERVICE: string;
export declare const GIIKER_CTRL_SERVICE: string;
/** GoCube UART. */
export declare const GOCUBE_UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
/**
 * Union of services commonly needed when connecting smart cubes via Web Bluetooth.
 */
export declare const DEFAULT_SMARTCUBE_OPTIONAL_SERVICES: readonly string[];
export declare function mergeOptionalServiceUuids(protocolServices: Iterable<string>): string[];
//# sourceMappingURL=default-optional-services.d.ts.map