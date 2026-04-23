/** MoYu32 AES session crypto keyed by device address (same derivation as protocol driver). */
export declare function createMoyu32SessionCrypto(mac: string): {
    decrypt(raw: number[]): number[];
    encrypt(data: number[]): number[];
};
//# sourceMappingURL=moyu32-session-crypto.d.ts.map