import { SmartCubeProtocol } from '../protocol';
/**
 * MsgOrientation payload: ASCII decimals `x#y#z#w` (see public GoCube UART docs). Normalize to a unit quaternion.
 * Integer components are scaled together so normalization yields the physical orientation.
 *
 * Wire `(rx,ry,rz,rw)` normalized to `(nx,ny,nz,nw)` then mapped to `(nx, -nz, -ny, nw)`.
 */
export declare function parseGoCubeOrientationPayload(payloadUtf8: string): {
    x: number;
    y: number;
    z: number;
    w: number;
} | null;
declare const goCubeProtocol: SmartCubeProtocol;
export { goCubeProtocol };
//# sourceMappingURL=gocube.d.ts.map