/**
 * Derive BLE address candidates from advertised device names (pattern-based only).
 */
/**
 * QiYi / XMD-style names: build candidate MACs for cryptographic probing.
 */
export declare function buildQiYiMacCandidatesFromName(deviceName: string | null | undefined): string[];
/**
 * MoYu32 / WCU name patterns: multiple third-byte variants per hardware line.
 */
export declare function buildMoyu32MacCandidatesFromName(deviceName: string | null | undefined): string[];
//# sourceMappingURL=mac-candidates.d.ts.map