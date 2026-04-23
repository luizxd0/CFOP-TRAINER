/**
 * Structural checks on decrypted GAN gen2/3/4 payloads (after AES).
 */
export declare class GanBitReader {
    private readonly bits;
    constructor(message: Uint8Array | readonly number[]);
    getBitWord(offset: number, bitLength: number, littleEndian?: boolean): number;
}
export declare function isValidGanGen2Packet(e: Uint8Array | number[]): boolean;
export declare function isValidGanGen3Packet(e: Uint8Array | number[]): boolean;
export declare function isValidGanGen4Packet(e: Uint8Array | number[]): boolean;
//# sourceMappingURL=gan-gen234-packet-validate.d.ts.map