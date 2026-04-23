declare const SOLVED_FACELET = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
declare const cFacelet: number[][];
declare const eFacelet: number[][];
declare class CubieCube {
    ca: number[];
    ea: number[];
    constructor();
    init(ca: number[], ea: number[]): CubieCube;
    static EdgeMult(a: CubieCube, b: CubieCube, prod: CubieCube): void;
    static CornMult(a: CubieCube, b: CubieCube, prod: CubieCube): void;
    static CubeMult(a: CubieCube, b: CubieCube, prod: CubieCube): void;
    toFaceCube(customCFacelet?: number[][], customEFacelet?: number[][]): string;
    fromFacelet(facelet: string, customCFacelet?: number[][], customEFacelet?: number[][]): CubieCube | -1;
    static moveCube: CubieCube[];
}
export { CubieCube, SOLVED_FACELET, cFacelet, eFacelet };
//# sourceMappingURL=cubie-cube.d.ts.map