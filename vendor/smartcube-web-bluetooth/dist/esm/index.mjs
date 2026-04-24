import { Subject, TimeoutError, filter, take } from 'rxjs';
import { ModeOfOperation, AES } from 'aes-js';
import { decompressFromEncodedURIComponent } from 'lz-string';

// GAN Smart Timer bluetooth service and characteristic UUIDs
const GAN_TIMER_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb';
const GAN_TIMER_TIME_CHARACTERISTIC = '0000fff2-0000-1000-8000-00805f9b34fb';
const GAN_TIMER_STATE_CHARACTERISTIC = '0000fff5-0000-1000-8000-00805f9b34fb';
/**
 * GAN Smart Timer events/states
 */
var GanTimerState;
(function (GanTimerState) {
    /** Fired when timer is disconnected from bluetooth */
    GanTimerState[GanTimerState["DISCONNECT"] = 0] = "DISCONNECT";
    /** Grace delay is expired and timer is ready to start */
    GanTimerState[GanTimerState["GET_SET"] = 1] = "GET_SET";
    /** Hands removed from the timer before grace delay expired */
    GanTimerState[GanTimerState["HANDS_OFF"] = 2] = "HANDS_OFF";
    /** Timer is running */
    GanTimerState[GanTimerState["RUNNING"] = 3] = "RUNNING";
    /** Timer is stopped, this event includes recorded time */
    GanTimerState[GanTimerState["STOPPED"] = 4] = "STOPPED";
    /** Timer is reset and idle */
    GanTimerState[GanTimerState["IDLE"] = 5] = "IDLE";
    /** Hands are placed on the timer */
    GanTimerState[GanTimerState["HANDS_ON"] = 6] = "HANDS_ON";
    /** Timer moves to this state immediately after STOPPED */
    GanTimerState[GanTimerState["FINISHED"] = 7] = "FINISHED";
})(GanTimerState || (GanTimerState = {}));
/**
 * Construct time object
 */
function makeTime(min, sec, msec) {
    return {
        minutes: min,
        seconds: sec,
        milliseconds: msec,
        asTimestamp: 60000 * min + 1000 * sec + msec,
        toString: () => `${min.toString(10)}:${sec.toString(10).padStart(2, '0')}.${msec.toString(10).padStart(3, '0')}`
    };
}
/**
 * Construct time object from raw event data
 */
function makeTimeFromRaw(data, offset) {
    var min = data.getUint8(offset);
    var sec = data.getUint8(offset + 1);
    var msec = data.getUint16(offset + 2, true);
    return makeTime(min, sec, msec);
}
/**
 * Construct time object from milliseconds timestamp
 */
function makeTimeFromTimestamp(timestamp) {
    var min = Math.trunc(timestamp / 60000);
    var sec = Math.trunc(timestamp % 60000 / 1000);
    var msec = Math.trunc(timestamp % 1000);
    return makeTime(min, sec, msec);
}
/**
 * Calculate ArrayBuffer checksum using CRC-16/CCIT-FALSE algorithm variation
 */
function crc16ccit(buff) {
    var dataView = new DataView(buff);
    var crc = 0xFFFF;
    for (let i = 0; i < dataView.byteLength; ++i) {
        crc ^= dataView.getUint8(i) << 8;
        for (let j = 0; j < 8; ++j) {
            crc = (crc & 0x8000) > 0 ? (crc << 1) ^ 0x1021 : crc << 1;
        }
    }
    return crc & 0xFFFF;
}
/**
 * Ensure received timer event has valid data: check data magic and CRC
 */
function validateEventData(data) {
    try {
        if (data?.byteLength == 0 || data.getUint8(0) != 0xFE) {
            return false;
        }
        var eventCRC = data.getUint16(data.byteLength - 2, true);
        var calculatedCRC = crc16ccit(data.buffer.slice(2, data.byteLength - 2));
        return eventCRC == calculatedCRC;
    }
    catch (err) {
        return false;
    }
}
/**
 * Construct event object from raw data
 */
function buildTimerEvent(data) {
    var evt = {
        state: data.getUint8(3)
    };
    if (evt.state == GanTimerState.STOPPED) {
        evt.recordedTime = makeTimeFromRaw(data, 4);
    }
    return evt;
}
/**
 * Initiate new connection with the GAN Smart Timer device
 * @returns Connection connection object representing connection API and state
 */
async function connectGanTimer() {
    // Request user for the bluetooth device (popup selection dialog)
    var device = await navigator.bluetooth.requestDevice({
        filters: [
            { namePrefix: "GAN" },
            { namePrefix: "gan" },
            { namePrefix: "Gan" }
        ],
        optionalServices: [GAN_TIMER_SERVICE]
    });
    // Connect to GATT server
    var server = await device.gatt.connect();
    // Connect to main timer service and characteristics
    var service = await server.getPrimaryService(GAN_TIMER_SERVICE);
    var timeCharacteristic = await service.getCharacteristic(GAN_TIMER_TIME_CHARACTERISTIC);
    var stateCharacteristic = await service.getCharacteristic(GAN_TIMER_STATE_CHARACTERISTIC);
    // Subscribe to value updates of the timer state characteristic
    var eventSubject = new Subject();
    var onStateChanged = async (evt) => {
        var chr = evt.target;
        var data = chr.value;
        if (validateEventData(data)) {
            eventSubject.next(buildTimerEvent(data));
        }
        else {
            eventSubject.error("Invalid event data received from Timer");
        }
    };
    stateCharacteristic.addEventListener('characteristicvaluechanged', onStateChanged);
    stateCharacteristic.startNotifications();
    // This action retrieves latest recorded times from timer
    var getRecordedTimesAction = async () => {
        var data = await timeCharacteristic.readValue();
        return data?.byteLength >= 16 ?
            Promise.resolve({
                displayTime: makeTimeFromRaw(data, 0),
                previousTimes: [makeTimeFromRaw(data, 4), makeTimeFromRaw(data, 8), makeTimeFromRaw(data, 12)]
            }) : Promise.reject("Invalid time characteristic value received from Timer");
    };
    // Manual disconnect action
    var disconnectAction = async () => {
        device.removeEventListener('gattserverdisconnected', disconnectAction);
        stateCharacteristic.removeEventListener('characteristicvaluechanged', onStateChanged);
        await stateCharacteristic.stopNotifications().catch(() => { });
        eventSubject.next({ state: GanTimerState.DISCONNECT });
        eventSubject.complete();
        if (server.connected) {
            server.disconnect();
        }
    };
    device.addEventListener('gattserverdisconnected', disconnectAction);
    return {
        events$: eventSubject,
        getRecordedTimes: getRecordedTimesAction,
        disconnect: disconnectAction,
    };
}

/** LZ-compressed key blobs for GAN gen1 `deriveKey`. */
const GAN_GEN1_COMPRESSED_KEYS = [
    "NoRgnAHANATADDWJYwMxQOxiiEcfYgSK6Hpr4TYCs0IG1OEAbDszALpA",
    "NoNg7ANATFIQnARmogLBRUCs0oAYN8U5J45EQBmFADg0oJAOSlUQF0g",
    "NoRgNATGBs1gLABgQTjCeBWSUDsYBmKbCeMADjNnXxHIoIF0g",
    "NoRg7ANAzBCsAMEAsioxBEIAc0Cc0ATJkgSIYhXIjhMQGxgC6QA",
    "NoVgNAjAHGBMYDYCcdJgCwTFBkYVgAY9JpJYUsYBmAXSA",
    "NoRgNAbAHGAsAMkwgMyzClH0LFcArHnAJzIqIBMGWEAukA",
];
/** GAN gen1 primary GATT service (356i “API v1”). */
const GAN_GEN1_PRIMARY_SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb";
/** Standard Device Information service (gen1 key derivation). */
const GAN_GEN1_DEVICE_INFO_SERVICE = "0000180a-0000-1000-8000-00805f9b34fb";
const GAN_GEN1_CHR_FIRMWARE = "00002a28-0000-1000-8000-00805f9b34fb";
const GAN_GEN1_CHR_HARDWARE = "00002a23-0000-1000-8000-00805f9b34fb";
const GAN_GEN1_CHR_STATE = "0000fff5-0000-1000-8000-00805f9b34fb";
const GAN_GEN1_CHR_MOVES = "0000fff6-0000-1000-8000-00805f9b34fb";
const GAN_GEN1_CHR_GYRO_NOTIFY = "0000fff4-0000-1000-8000-00805f9b34fb";
const GAN_GEN1_CHR_BATTERY = "0000fff7-0000-1000-8000-00805f9b34fb";
const GAN_GEN1_CHR_FACELETS = "0000fff2-0000-1000-8000-00805f9b34fb";
/** GAN Gen2 protocol BLE service */
const GAN_GEN2_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dc4179";
/** GAN Gen2 protocol BLE command characteristic */
const GAN_GEN2_COMMAND_CHARACTERISTIC = "28be4a4a-cd67-11e9-a32f-2a2ae2dbcce4";
/** GAN Gen2 protocol BLE state characteristic */
const GAN_GEN2_STATE_CHARACTERISTIC = "28be4cb6-cd67-11e9-a32f-2a2ae2dbcce4";
/** GAN Gen3 protocol BLE service */
const GAN_GEN3_SERVICE = "8653000a-43e6-47b7-9cb0-5fc21d4ae340";
/** GAN Gen3 protocol BLE command characteristic */
const GAN_GEN3_COMMAND_CHARACTERISTIC = "8653000c-43e6-47b7-9cb0-5fc21d4ae340";
/** GAN Gen3 protocol BLE state characteristic */
const GAN_GEN3_STATE_CHARACTERISTIC = "8653000b-43e6-47b7-9cb0-5fc21d4ae340";
/** GAN Gen4 protocol BLE service */
const GAN_GEN4_SERVICE = "00000010-0000-fff7-fff6-fff5fff4fff0";
/** GAN Gen4 protocol BLE command characteristic */
const GAN_GEN4_COMMAND_CHARACTERISTIC = "0000fff5-0000-1000-8000-00805f9b34fb";
/** GAN Gen4 protocol BLE state characteristic */
const GAN_GEN4_STATE_CHARACTERISTIC = "0000fff6-0000-1000-8000-00805f9b34fb";
/** List of Company Identifier Codes, fill with all values [0x0001, 0xFF01] possible for GAN cubes */
const GAN_CIC_LIST = Array(256).fill(undefined).map((_v, i) => (i << 8) | 0x01);
/**  List of encryption keys */
const GAN_ENCRYPTION_KEYS = [
    {
        key: [0x01, 0x02, 0x42, 0x28, 0x31, 0x91, 0x16, 0x07, 0x20, 0x05, 0x18, 0x54, 0x42, 0x11, 0x12, 0x53],
        iv: [0x11, 0x03, 0x32, 0x28, 0x21, 0x01, 0x76, 0x27, 0x20, 0x95, 0x78, 0x14, 0x32, 0x12, 0x02, 0x43]
    },
    {
        key: [0x05, 0x12, 0x02, 0x45, 0x02, 0x01, 0x29, 0x56, 0x12, 0x78, 0x12, 0x76, 0x81, 0x01, 0x08, 0x03],
        iv: [0x01, 0x44, 0x28, 0x06, 0x86, 0x21, 0x22, 0x28, 0x51, 0x05, 0x08, 0x31, 0x82, 0x02, 0x21, 0x06]
    }
];

/**
 * Implementation for encryption scheme used in the GAN Gen2 Smart Cubes
 */
class GanGen2CubeEncrypter {
    constructor(key, iv, salt) {
        if (key.length != 16)
            throw new Error("Key must be 16 bytes (128-bit) long");
        if (iv.length != 16)
            throw new Error("Iv must be 16 bytes (128-bit) long");
        if (salt.length != 6)
            throw new Error("Salt must be 6 bytes (48-bit) long");
        // Apply salt to key and iv
        this._key = new Uint8Array(key);
        this._iv = new Uint8Array(iv);
        for (let i = 0; i < 6; i++) {
            this._key[i] = (key[i] + salt[i]) % 0xFF;
            this._iv[i] = (iv[i] + salt[i]) % 0xFF;
        }
    }
    /** Encrypt 16-byte buffer chunk starting at offset using AES-128-CBC */
    encryptChunk(buffer, offset) {
        var cipher = new ModeOfOperation.cbc(this._key, this._iv);
        var chunk = cipher.encrypt(buffer.subarray(offset, offset + 16));
        buffer.set(chunk, offset);
    }
    /** Decrypt 16-byte buffer chunk starting at offset using AES-128-CBC */
    decryptChunk(buffer, offset) {
        var cipher = new ModeOfOperation.cbc(this._key, this._iv);
        var chunk = cipher.decrypt(buffer.subarray(offset, offset + 16));
        buffer.set(chunk, offset);
    }
    encrypt(data) {
        if (data.length < 16)
            throw Error('Data must be at least 16 bytes long');
        var res = new Uint8Array(data);
        // encrypt 16-byte chunk aligned to message start
        this.encryptChunk(res, 0);
        // encrypt 16-byte chunk aligned to message end
        if (res.length > 16) {
            this.encryptChunk(res, res.length - 16);
        }
        return res;
    }
    decrypt(data) {
        if (data.length < 16)
            throw Error('Data must be at least 16 bytes long');
        var res = new Uint8Array(data);
        // decrypt 16-byte chunk aligned to message end
        if (res.length > 16) {
            this.decryptChunk(res, res.length - 16);
        }
        // decrypt 16-byte chunk aligned to message start
        this.decryptChunk(res, 0);
        return res;
    }
}
/**
 * Implementation for encryption scheme used in the GAN Gen3 cubes
 */
class GanGen3CubeEncrypter extends GanGen2CubeEncrypter {
}
/**
 * Implementation for encryption scheme used in the GAN Gen3 cubes
 */
class GanGen4CubeEncrypter extends GanGen2CubeEncrypter {
}

/**
 * Return current host clock timestamp with millisecond precision
 * Use monotonic clock when available
 * @returns Current host clock timestamp in milliseconds
 */
const now = typeof window != 'undefined' && typeof window.performance?.now == 'function' ?
    () => Math.floor(window.performance.now()) :
    typeof process != 'undefined' && typeof process.hrtime?.bigint == 'function' ?
        () => Number(process.hrtime.bigint() / 1000000n) :
        () => Date.now();
function linregress(X, Y) {
    var sumX = 0;
    var sumY = 0;
    var sumXY = 0;
    var sumXX = 0;
    var n = 0;
    for (var i = 0; i < X.length; i++) {
        var x = X[i];
        var y = Y[i];
        if (x == null || y == null) {
            continue;
        }
        n++;
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    }
    var varX = n * sumXX - sumX * sumX;
    var covXY = n * sumXY - sumX * sumY;
    var slope = varX < 1e-3 ? 1 : covXY / varX;
    var intercept = n < 1 ? 0 : sumY / n - slope * sumX / n;
    return [slope, intercept];
}
/**
 * Use linear regression to fit timestamps reported by cube hardware with host device timestamps
 * @param cubeMoves List representing window of cube moves to operate on
 * @returns New copy of move list with fitted cubeTimestamp values
 */
function cubeTimestampLinearFit(cubeMoves) {
    var res = [];
    // Calculate and fix timestamp values for missed and recovered cube moves.
    if (cubeMoves.length >= 2) {
        // 1st pass - tail-to-head, align missed move cube timestamps to next move -50ms
        for (let i = cubeMoves.length - 1; i > 0; i--) {
            if (cubeMoves[i].cubeTimestamp != null && cubeMoves[i - 1].cubeTimestamp == null)
                cubeMoves[i - 1].cubeTimestamp = cubeMoves[i].cubeTimestamp - 50;
        }
        // 2nd pass - head-to-tail, align missed move cube timestamp to prev move +50ms
        for (let i = 0; i < cubeMoves.length - 1; i++) {
            if (cubeMoves[i].cubeTimestamp != null && cubeMoves[i + 1].cubeTimestamp == null)
                cubeMoves[i + 1].cubeTimestamp = cubeMoves[i].cubeTimestamp + 50;
        }
    }
    // Apply linear regression to the cube timestamps
    if (cubeMoves.length > 0) {
        var [slope, intercept] = linregress(cubeMoves.map(m => m.cubeTimestamp), cubeMoves.map(m => m.localTimestamp));
        var first = Math.round(slope * cubeMoves[0].cubeTimestamp + intercept);
        cubeMoves.forEach(m => {
            res.push({
                face: m.face,
                direction: m.direction,
                move: m.move,
                localTimestamp: m.localTimestamp,
                cubeTimestamp: Math.round(slope * m.cubeTimestamp + intercept) - first
            });
        });
    }
    return res;
}
/**
 * Calculate time skew degree in percent between cube hardware and host device
 * @param cubeMoves List representing window of cube moves to operate on
 * @returns Time skew value in percent
 */
function cubeTimestampCalcSkew(cubeMoves) {
    if (!cubeMoves.length)
        return 0;
    var [slope] = linregress(cubeMoves.map(m => m.localTimestamp), cubeMoves.map(m => m.cubeTimestamp));
    return Math.round((slope - 1) * 100000) / 1000;
}
const CORNER_FACELET_MAP = [
    [8, 9, 20], // URF
    [6, 18, 38], // UFL
    [0, 36, 47], // ULB
    [2, 45, 11], // UBR
    [29, 26, 15], // DFR
    [27, 44, 24], // DLF
    [33, 53, 42], // DBL
    [35, 17, 51] // DRB
];
const EDGE_FACELET_MAP = [
    [5, 10], // UR
    [7, 19], // UF
    [3, 37], // UL
    [1, 46], // UB
    [32, 16], // DR
    [28, 25], // DF
    [30, 43], // DL
    [34, 52], // DB
    [23, 12], // FR
    [21, 41], // FL
    [50, 39], // BL
    [48, 14] // BR
];
/**
 *
 * Convert Corner/Edge Permutation/Orientation cube state to the Kociemba facelets representation string
 *
 * Example - solved state:
 *   cp = [0, 1, 2, 3, 4, 5, 6, 7]
 *   co = [0, 0, 0, 0, 0, 0, 0, 0]
 *   ep = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
 *   eo = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
 *   facelets = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"
 * Example - state after F R moves made:
 *   cp = [0, 5, 2, 1, 7, 4, 6, 3]
 *   co = [1, 2, 0, 2, 1, 1, 0, 2]
 *   ep = [1, 9, 2, 3, 11, 8, 6, 7, 4, 5, 10, 0]
 *   eo = [1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]
 *   facelets = "UUFUUFLLFUUURRRRRRFFRFFDFFDRRBDDBDDBLLDLLDLLDLBBUBBUBB"
 *
 * @param cp Corner Permutation
 * @param co Corner Orientation
 * @param ep Egde Permutation
 * @param eo Edge Orientation
 * @returns Cube state in the Kociemba facelets representation string
 *
 */
function toKociembaFacelets(cp, co, ep, eo) {
    var faces = "URFDLB";
    var facelets = [];
    for (let i = 0; i < 54; i++) {
        facelets[i] = faces[~~(i / 9)];
    }
    for (let i = 0; i < 8; i++) {
        for (let p = 0; p < 3; p++) {
            facelets[CORNER_FACELET_MAP[i][(p + co[i]) % 3]] = faces[~~(CORNER_FACELET_MAP[cp[i]][p] / 9)];
        }
    }
    for (let i = 0; i < 12; i++) {
        for (let p = 0; p < 2; p++) {
            facelets[EDGE_FACELET_MAP[i][(p + eo[i]) % 2]] = faces[~~(EDGE_FACELET_MAP[ep[i]][p] / 9)];
        }
    }
    return facelets.join('');
}

class GanGen1Aes {
    constructor(keyBytes) {
        this.aes = new AES([...keyBytes]);
    }
    decrypt(data) {
        if (data.length < 16)
            throw new Error('Invalid data length');
        const t = Array.from(data);
        if (t.length > 16) {
            const i = t.length - 16;
            const n = this.aes.decrypt(t.slice(i, i + 16));
            for (let r = 0; r < 16; r++)
                t[r + i] = n[r];
        }
        const s = this.aes.decrypt(t.slice(0, 16));
        for (let r = 0; r < 16; r++)
            t[r] = s[r];
        return new Uint8Array(t);
    }
}
function deriveGen1Key(fwVersion, hw) {
    const idx = (fwVersion >> 8) & 255;
    const compressed = GAN_GEN1_COMPRESSED_KEYS[idx] ?? GAN_GEN1_COMPRESSED_KEYS[0];
    if (!compressed)
        return null;
    const json = decompressFromEncodedURIComponent(compressed);
    if (!json)
        return null;
    let arr;
    try {
        arr = JSON.parse(json);
    }
    catch {
        return null;
    }
    if (!Array.isArray(arr) || arr.length < 6)
        return null;
    if (hw.byteLength < 6)
        return null;
    for (let s = 0; s < 6; s++) {
        arr[s] = (arr[s] + hw.getUint8(5 - s)) & 255;
    }
    if (arr.length < 16)
        return null;
    return new Uint8Array(arr.slice(0, 16));
}
function gyroFromState(t) {
    if (t.length < 6)
        return null;
    let x0 = t[0] | (t[1] << 8);
    let x1 = t[2] | (t[3] << 8);
    let x2 = t[4] | (t[5] << 8);
    if (x0 > 32767)
        x0 -= 65536;
    if (x1 > 32767)
        x1 -= 65536;
    if (x2 > 32767)
        x2 -= 65536;
    const r = x0 / 16384;
    const s = x1 / 16384;
    const a = x2 / 16384;
    const o = 1 - r * r - s * s - a * a;
    return { x: r, y: a, z: -s, w: o > 0 ? Math.sqrt(o) : 0 };
}
function parseGen1Facelets(t) {
    const out = [];
    for (let i = 0; i < t.length - 2; i += 3) {
        const n = (t[1 ^ i] << 16) | (t[(i + 1) ^ 1] << 8) | t[(i + 2) ^ 1];
        for (let r = 21; r >= 0; r -= 3) {
            out.push('URFDLB'.charAt((n >> r) & 7));
            if (r === 12)
                out.push('URFDLB'.charAt(i / 3));
        }
    }
    return out.join('');
}
/** Placeholder cubelets state when gen1 only supplies a facelet string. */
const GEN1_SOLVED_STATE = {
    CP: [0, 1, 2, 3, 4, 5, 6, 7],
    CO: [0, 0, 0, 0, 0, 0, 0, 0],
    EP: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    EO: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};
/**
 * GAN 356i “API v1”: primary service `fff0` + Device Information for key derivation.
 */
class GanGen1CubeConnection {
    constructor(device, encrypter, events$, chrState, chrMoves, chrFacelets, chrBattery, chrGyroNotify) {
        this.deviceMAC = '';
        this.polling = false;
        this.prevMoveCnt = -1;
        this.movePollTicks = 0;
        this.batteryPollTicks = 0;
        this.pollFailures = 0;
        this.teardown = false;
        this.lastBatteryLevel = null;
        this.forceNextBatteryEmission = false;
        this.onGyroNotify = (evt) => {
            try {
                const chr = evt.target;
                const e = chr.value;
                if (!e || e.byteLength < 16)
                    return;
                const dec = this.encrypter.decrypt(new Uint8Array(e.buffer, e.byteOffset, e.byteLength));
                const q = gyroFromState(dec);
                if (q) {
                    this.events$.next({ type: 'GYRO', timestamp: now(), quaternion: q });
                }
            }
            catch {
                /* ignore corrupt frame */
            }
        };
        this.device = device;
        this.encrypter = encrypter;
        this.events$ = events$;
        this.chrState = chrState;
        this.chrMoves = chrMoves;
        this.chrFacelets = chrFacelets;
        this.chrBattery = chrBattery;
        this.chrGyroNotify = chrGyroNotify;
        this.onGattDisconnected = () => void this.handleDisconnect();
        this.device.addEventListener('gattserverdisconnected', this.onGattDisconnected);
    }
    get deviceName() {
        return this.device.name || 'GAN356i v1';
    }
    static async create(device) {
        const gatt = device.gatt;
        if (!gatt?.connected) {
            throw new Error('GATT must be connected before GAN gen1 setup');
        }
        const deviceInfo = await gatt.getPrimaryService(GAN_GEN1_DEVICE_INFO_SERVICE);
        const fwChar = await deviceInfo.getCharacteristic(GAN_GEN1_CHR_FIRMWARE);
        const hwChar = await deviceInfo.getCharacteristic(GAN_GEN1_CHR_HARDWARE);
        const fw = await fwChar.readValue();
        const n = fw.byteLength >= 3
            ? (fw.getUint8(0) << 16) | (fw.getUint8(1) << 8) | fw.getUint8(2)
            : 0;
        if (!(n > 65543 && (16776704 & n) === 65536)) {
            throw new Error(`Invalid firmware version: 0x${n.toString(16)}`);
        }
        const hwRaw = await hwChar.readValue();
        const keyArr = deriveGen1Key(n, hwRaw);
        if (!keyArr) {
            throw new Error('Invalid encryption key');
        }
        const encrypter = new GanGen1Aes(keyArr);
        const primary = await gatt.getPrimaryService(GAN_GEN1_PRIMARY_SERVICE);
        const chrState = await primary.getCharacteristic(GAN_GEN1_CHR_STATE);
        const chrMoves = await primary.getCharacteristic(GAN_GEN1_CHR_MOVES);
        const chrFacelets = await primary.getCharacteristic(GAN_GEN1_CHR_FACELETS);
        const chrBattery = await primary.getCharacteristic(GAN_GEN1_CHR_BATTERY);
        const chrGyroNotify = await primary.getCharacteristic(GAN_GEN1_CHR_GYRO_NOTIFY);
        const events$ = new Subject();
        const conn = new GanGen1CubeConnection(device, encrypter, events$, chrState, chrMoves, chrFacelets, chrBattery, chrGyroNotify);
        chrGyroNotify.addEventListener('characteristicvaluechanged', conn.onGyroNotify);
        await chrGyroNotify.startNotifications();
        await conn.readInitialState();
        await conn.readBattery();
        conn.polling = true;
        conn.schedulePoll(0);
        return conn;
    }
    emitBatteryLevel(rawLevel, timestamp = now()) {
        if (!Number.isFinite(rawLevel)) {
            return;
        }
        const batteryLevel = Math.min(100, Math.max(0, Math.round(rawLevel)));
        const forceEmission = this.forceNextBatteryEmission;
        this.forceNextBatteryEmission = false;
        if (!forceEmission && this.lastBatteryLevel === batteryLevel) {
            return;
        }
        this.lastBatteryLevel = batteryLevel;
        this.events$.next({
            type: 'BATTERY',
            batteryLevel,
            timestamp,
        });
    }
    async readBattery() {
        try {
            const e = await this.chrBattery.readValue();
            const t = this.encrypter.decrypt(new Uint8Array(e.buffer, e.byteOffset, e.byteLength));
            if (t.length < 8)
                return;
            this.emitBatteryLevel(t[7]);
        }
        catch {
            /* ignore */
        }
    }
    async readInitialState() {
        try {
            const e = await this.chrFacelets.readValue();
            const t = this.encrypter.decrypt(new Uint8Array(e.buffer, e.byteOffset, e.byteLength));
            this.events$.next({
                timestamp: now(),
                type: 'FACELETS',
                serial: 0,
                facelets: parseGen1Facelets(t),
                state: {
                    CP: [...GEN1_SOLVED_STATE.CP],
                    CO: [...GEN1_SOLVED_STATE.CO],
                    EP: [...GEN1_SOLVED_STATE.EP],
                    EO: [...GEN1_SOLVED_STATE.EO],
                },
            });
        }
        catch {
            /* ignore */
        }
    }
    schedulePoll(delayMs) {
        if (!this.polling || this.teardown)
            return;
        setTimeout(() => void this.pollLoop(), delayMs);
    }
    async pollLoop() {
        if (!this.polling || this.teardown)
            return;
        try {
            const e = await this.chrState.readValue();
            const t = this.encrypter.decrypt(new Uint8Array(e.buffer, e.byteOffset, e.byteLength));
            this.pollFailures = 0;
            const q = gyroFromState(t);
            if (q) {
                this.events$.next({ type: 'GYRO', timestamp: now(), quaternion: q });
            }
            const moveCnt = t[12];
            if (this.prevMoveCnt === -1) {
                this.prevMoveCnt = moveCnt;
            }
            else if (moveCnt !== this.prevMoveCnt) {
                let o = (moveCnt - this.prevMoveCnt) & 255;
                if (o > 6)
                    o = 6;
                const moves = [];
                for (let l = 0; l < 6; l++) {
                    const u = t[13 + l];
                    moves.unshift('URFDLB'.charAt(~~(u / 3)) + " 2'".charAt(u % 3));
                }
                const moveData = await this.chrMoves.readValue();
                const mt = this.encrypter.decrypt(new Uint8Array(moveData.buffer, moveData.byteOffset, moveData.byteLength));
                const stamps = [];
                for (let r = 0; r < 9; r++) {
                    stamps.unshift(mt[2 * r + 1] | (mt[2 * r + 2] << 8));
                }
                const ts = now();
                for (let r = o - 1; r >= 0; r--) {
                    const d = moves[r]?.trim();
                    if (!d)
                        continue;
                    const f = 'URFDLB'.indexOf(d[0]);
                    const h = d.endsWith("'") ? 1 : 0;
                    this.events$.next({
                        timestamp: ts,
                        type: 'MOVE',
                        serial: (moveCnt - r) & 255,
                        face: f,
                        direction: h,
                        move: d,
                        cubeTimestamp: stamps[r] ?? null,
                        localTimestamp: ts,
                    });
                }
                this.prevMoveCnt = moveCnt;
            }
            this.movePollTicks++;
            if (this.movePollTicks >= 50) {
                this.movePollTicks = 0;
                await this.readInitialState();
            }
            this.batteryPollTicks += 30;
            if (this.batteryPollTicks >= 60000) {
                this.batteryPollTicks = 0;
                await this.readBattery();
            }
            this.schedulePoll(30);
        }
        catch {
            this.pollFailures++;
            const wait = Math.min(500 * 2 ** Math.min(this.pollFailures, 4), 2000);
            this.schedulePoll(wait);
        }
    }
    async handleDisconnect() {
        if (this.teardown)
            return;
        this.teardown = true;
        this.polling = false;
        this.lastBatteryLevel = null;
        this.forceNextBatteryEmission = false;
        this.device.removeEventListener('gattserverdisconnected', this.onGattDisconnected);
        try {
            this.chrGyroNotify.removeEventListener('characteristicvaluechanged', this.onGyroNotify);
            await this.chrGyroNotify.stopNotifications().catch(() => { });
        }
        catch {
            /* ignore */
        }
        this.events$.next({ timestamp: now(), type: 'DISCONNECT' });
        this.events$.complete();
    }
    async sendCubeCommand(command) {
        switch (command.type) {
            case 'REQUEST_BATTERY':
                this.forceNextBatteryEmission = true;
                await this.readBattery();
                break;
            case 'REQUEST_FACELETS':
                await this.readInitialState();
                break;
        }
    }
    async disconnect() {
        await this.handleDisconnect();
        if (this.device.gatt?.connected) {
            this.device.gatt.disconnect();
        }
    }
}

/** 6-byte MAC as reversed salt for GAN gen2–4 AES; throws if invalid. */
function macStringToSaltOrThrow(mac) {
    const parts = mac.split(/[:-\s]+/).filter(Boolean);
    if (parts.length !== 6) {
        throw new Error('GAN gen2–4 requires a valid 6-byte Bluetooth MAC (e.g. aa:bb:cc:dd:ee:ff).');
    }
    const bytes = parts.map((c) => {
        const n = parseInt(c, 16);
        if (!Number.isFinite(n) || n < 0 || n > 255) {
            throw new Error('Invalid MAC address segment.');
        }
        return n;
    });
    return new Uint8Array(bytes.reverse());
}

/**
 * Structural checks on decrypted GAN gen2/3/4 payloads (after AES).
 */
class GanBitReader {
    constructor(message) {
        this.bits = Array.from(message, (b) => (b + 256).toString(2).slice(1)).join('');
    }
    getBitWord(offset, bitLength, littleEndian = false) {
        if (bitLength <= 8) {
            return parseInt(this.bits.slice(offset, offset + bitLength), 2);
        }
        if (bitLength === 16 || bitLength === 32) {
            const buf = new Uint8Array(bitLength / 8);
            for (let i = 0; i < buf.length; i++) {
                buf[i] = parseInt(this.bits.slice(8 * i + offset, 8 * i + offset + 8), 2);
            }
            const dv = new DataView(buf.buffer);
            return bitLength === 16 ? dv.getUint16(0, littleEndian) : dv.getUint32(0, littleEndian);
        }
        throw new Error('Invalid BitWord size');
    }
}
function isValidGanGen2Packet(e) {
    if (!e || e.length < 16)
        return false;
    try {
        const t = new GanBitReader(e);
        const i = t.getBitWord(0, 4);
        if (![1, 2, 4, 5, 9, 13].includes(i))
            return false;
        if (i === 1) {
            const a = t.getBitWord(4, 16);
            const b = t.getBitWord(20, 16);
            const c = t.getBitWord(36, 16);
            const d = t.getBitWord(52, 16);
            if (a === 0 && b === 0 && c === 0 && d === 0)
                return false;
        }
        else if (i === 2) {
            for (let j = 0; j < 7; j++) {
                const v = t.getBitWord(12 + 5 * j, 4);
                if (v > 5)
                    return false;
            }
        }
        else if (i === 4) {
            let s = 0;
            for (let j = 0; j < 7; j++)
                s += t.getBitWord(12 + 3 * j, 3);
            if (s > 28)
                return false;
            let x = 0;
            for (let j = 0; j < 11; j++)
                x += t.getBitWord(47 + 4 * j, 4);
            if (x > 66)
                return false;
            let n = 0;
            for (let j = 0; j < 11; j++)
                n += t.getBitWord(91 + j, 1);
            if (n % 2 !== 0)
                return false;
        }
        else if (i === 9) {
            if (t.getBitWord(8, 8) > 100)
                return false;
        }
        else if (i === 5) {
            for (let j = 0; j < 8; j++) {
                const v = t.getBitWord(8 * j + 40, 8);
                if (v !== 0 && (v < 32 || v > 126))
                    return false;
            }
        }
        return true;
    }
    catch {
        return false;
    }
}
function isValidGanGen3Packet(e) {
    if (!e || e.length < 16)
        return false;
    try {
        const t = new GanBitReader(e);
        const i = t.getBitWord(0, 8);
        const n = t.getBitWord(8, 8);
        const r = t.getBitWord(16, 8);
        if (i !== 85 || r === 0 || ![1, 2, 6, 7, 16, 17].includes(n))
            return false;
        if (n === 1) {
            const f = t.getBitWord(74, 6);
            if ([2, 32, 8, 1, 16, 4].indexOf(f) < 0)
                return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
function isValidGanGen4Packet(e) {
    if (!e || e.length < 16)
        return false;
    try {
        const t = new GanBitReader(e);
        const i = t.getBitWord(0, 8);
        if (![1, 209, 237, 236, 239, 234, 250, 251, 252, 253, 254].includes(i))
            return false;
        if (i === 1) {
            const f = t.getBitWord(66, 6);
            if ([2, 32, 8, 1, 16, 4].indexOf(f) < 0)
                return false;
        }
        return true;
    }
    catch {
        return false;
    }
}

/** Normalize BLE UUID to 128-bit uppercase (16-bit UUIDs expanded per SIG base). */
function normalizeUuid(uuid) {
    let u = uuid;
    if (/^[0-9A-Fa-f]{4}$/.exec(u)) {
        u = '0000' + u + '-0000-1000-8000-00805F9B34FB';
    }
    return u.toUpperCase();
}

/**
 * Serializes GATT write operations (writeValueWithResponse / writeValueWithoutResponse) to avoid overlapping operations on some stacks.
 */
class GattWriteQueue {
    constructor() {
        this.tail = Promise.resolve();
    }
    enqueue(fn) {
        const run = this.tail.then(() => fn());
        this.tail = run.then(() => { }, () => { });
        return run;
    }
}

/**
 * One in-flight GATT operation per connection on common stacks; overlapping writes throw
 * NetworkError "GATT operation already in progress". Queue writes per device.
 */
const writeQueuesByDevice = new WeakMap();
function writeQueueForCharacteristic(characteristic) {
    const device = characteristic.service.device;
    let q = writeQueuesByDevice.get(device);
    if (!q) {
        q = new GattWriteQueue();
        writeQueuesByDevice.set(device, q);
    }
    return q;
}
/**
 * Writes using explicit Web Bluetooth APIs (writeValue is deprecated).
 * Chooses write-with-response vs write-without-response from characteristic.properties.
 * When both are supported, prefers write-with-response for reliable cross-platform command traffic.
 */
function writeGattCharacteristicValueNow(characteristic, value) {
    const { write, writeWithoutResponse } = characteristic.properties;
    if (!write && !writeWithoutResponse) {
        return Promise.reject(new Error('Characteristic is not writable'));
    }
    if (writeWithoutResponse && !write) {
        return characteristic.writeValueWithoutResponse(value);
    }
    if (write && !writeWithoutResponse) {
        return characteristic.writeValueWithResponse(value);
    }
    return characteristic.writeValueWithResponse(value);
}
function writeGattCharacteristicValue(characteristic, value) {
    return writeQueueForCharacteristic(characteristic).enqueue(() => writeGattCharacteristicValueNow(characteristic, value));
}

/** Calculate sum of all numbers in array */
const sum = arr => arr.reduce((a, v) => a + v, 0);
/**
 * Implementation of classic command/response connection with GAN Smart Cube device
 */
class GanCubeClassicConnection {
    constructor(device, commandCharacteristic, stateCharacteristic, encrypter, driver, validateDecrypted) {
        this.writeQueue = new GattWriteQueue();
        this.disconnectOnce = false;
        this.onStateUpdate = async (evt) => {
            try {
                var characteristic = evt.target;
                var eventMessage = characteristic.value;
                if (!eventMessage || eventMessage.byteLength < 16)
                    return;
                var raw = new Uint8Array(eventMessage.buffer, eventMessage.byteOffset, eventMessage.byteLength);
                var decryptedMessage = this.encrypter.decrypt(raw);
                if (this.validateDecrypted && !this.validateDecrypted(decryptedMessage))
                    return;
                var cubeEvents = await this.driver.handleStateEvent(this, decryptedMessage);
                cubeEvents.forEach(e => this.events$.next(e));
            }
            catch {
                /* ignore corrupt frame */
            }
        };
        this.onDisconnect = async () => {
            if (this.disconnectOnce)
                return;
            this.disconnectOnce = true;
            this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
            this.stateCharacteristic.removeEventListener('characteristicvaluechanged', this.onStateUpdate);
            await this.stateCharacteristic.stopNotifications().catch(() => { });
            if (!this.events$.closed) {
                this.events$.next({ timestamp: now(), type: "DISCONNECT" });
                this.events$.complete();
            }
        };
        this.device = device;
        this.commandCharacteristic = commandCharacteristic;
        this.stateCharacteristic = stateCharacteristic;
        this.encrypter = encrypter;
        this.driver = driver;
        this.validateDecrypted = validateDecrypted;
        this.events$ = new Subject();
    }
    static async create(device, commandCharacteristic, stateCharacteristic, encrypter, driver, options) {
        var conn = new GanCubeClassicConnection(device, commandCharacteristic, stateCharacteristic, encrypter, driver, options?.validateDecrypted);
        conn.device.addEventListener('gattserverdisconnected', conn.onDisconnect);
        conn.stateCharacteristic.addEventListener('characteristicvaluechanged', conn.onStateUpdate);
        await conn.stateCharacteristic.startNotifications();
        return conn;
    }
    get deviceName() {
        return this.device.name || "GAN-XXXX";
    }
    get deviceMAC() {
        return this.device.mac || "00:00:00:00:00:00";
    }
    async sendCommandMessage(message) {
        var encryptedMessage = this.encrypter.encrypt(message);
        return this.writeQueue.enqueue(() => writeGattCharacteristicValue(this.commandCharacteristic, encryptedMessage));
    }
    async sendCubeCommand(command) {
        var commandMessage = this.driver.createCommandMessage(command);
        if (commandMessage) {
            return this.sendCommandMessage(commandMessage);
        }
    }
    async disconnect() {
        await this.onDisconnect();
        if (this.device.gatt?.connected) {
            this.device.gatt?.disconnect();
        }
    }
}
/**
 * View for binary protocol messages allowing to retrieve from message arbitrary length bit words
 */
class GanProtocolMessageView {
    constructor(message) {
        this.bits = Array.from(message).map(byte => (byte + 0x100).toString(2).slice(1)).join('');
    }
    getBitWord(startBit, bitLength, littleEndian = false) {
        if (bitLength <= 8) {
            return parseInt(this.bits.slice(startBit, startBit + bitLength), 2);
        }
        else if (bitLength == 16 || bitLength == 32) {
            let buf = new Uint8Array(bitLength / 8);
            for (let i = 0; i < buf.length; i++) {
                buf[i] = parseInt(this.bits.slice(8 * i + startBit, 8 * i + startBit + 8), 2);
            }
            let dv = new DataView(buf.buffer);
            return bitLength == 16 ? dv.getUint16(0, littleEndian) : dv.getUint32(0, littleEndian);
        }
        else {
            throw new Error('Unsupproted bit word length');
        }
    }
}
/**
 * Driver implementation for GAN Gen2 protocol, supported cubes:
 *  - GAN Mini ui FreePlay
 *  - GAN12 ui FreePlay
 *  - GAN12 ui
 *  - GAN356 i Carry S
 *  - GAN356 i Carry
 *  - GAN356 i 3
 *  - Monster Go 3Ai
 */
class GanGen2ProtocolDriver {
    constructor() {
        this.lastSerial = -1;
        this.lastMoveTimestamp = 0;
        this.cubeTimestamp = 0;
    }
    createCommandMessage(command) {
        var msg = new Uint8Array(20).fill(0);
        switch (command.type) {
            case 'REQUEST_FACELETS':
                msg[0] = 0x04;
                break;
            case 'REQUEST_HARDWARE':
                msg[0] = 0x05;
                break;
            case 'REQUEST_BATTERY':
                msg[0] = 0x09;
                break;
            case 'REQUEST_RESET':
                msg.set([0x0A, 0x05, 0x39, 0x77, 0x00, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
                break;
            default:
                msg = undefined;
        }
        return msg;
    }
    async handleStateEvent(conn, eventMessage) {
        var timestamp = now();
        var cubeEvents = [];
        var msg = new GanProtocolMessageView(eventMessage);
        var eventType = msg.getBitWord(0, 4);
        if (eventType == 0x01) { // GYRO
            // Orientation Quaternion
            let qw = msg.getBitWord(4, 16);
            let qx = msg.getBitWord(20, 16);
            let qy = msg.getBitWord(36, 16);
            let qz = msg.getBitWord(52, 16);
            // Angular Velocity
            let vx = msg.getBitWord(68, 4);
            let vy = msg.getBitWord(72, 4);
            let vz = msg.getBitWord(76, 4);
            cubeEvents.push({
                type: "GYRO",
                timestamp: timestamp,
                quaternion: {
                    x: (1 - (qx >> 15) * 2) * (qx & 0x7FFF) / 0x7FFF,
                    y: (1 - (qy >> 15) * 2) * (qy & 0x7FFF) / 0x7FFF,
                    z: (1 - (qz >> 15) * 2) * (qz & 0x7FFF) / 0x7FFF,
                    w: (1 - (qw >> 15) * 2) * (qw & 0x7FFF) / 0x7FFF
                },
                velocity: {
                    x: (1 - (vx >> 3) * 2) * (vx & 0x7),
                    y: (1 - (vy >> 3) * 2) * (vy & 0x7),
                    z: (1 - (vz >> 3) * 2) * (vz & 0x7)
                }
            });
        }
        else if (eventType == 0x02) { // MOVE
            if (this.lastSerial != -1) { // Accept move events only after first facelets state event received
                let serial = msg.getBitWord(4, 8);
                let diff = Math.min((serial - this.lastSerial) & 0xFF, 7);
                this.lastSerial = serial;
                if (diff > 0) {
                    for (let i = diff - 1; i >= 0; i--) {
                        let face = msg.getBitWord(12 + 5 * i, 4);
                        let direction = msg.getBitWord(16 + 5 * i, 1);
                        let move = "URFDLB".charAt(face) + " '".charAt(direction);
                        let elapsed = msg.getBitWord(47 + 16 * i, 16);
                        if (elapsed == 0) { // In case of 16-bit cube timestamp register overflow
                            elapsed = timestamp - this.lastMoveTimestamp;
                        }
                        this.cubeTimestamp += elapsed;
                        cubeEvents.push({
                            type: "MOVE",
                            serial: (serial - i) & 0xFF,
                            timestamp: timestamp,
                            localTimestamp: i == 0 ? timestamp : null, // Missed and recovered events has no meaningfull local timestamps
                            cubeTimestamp: this.cubeTimestamp,
                            face: face,
                            direction: direction,
                            move: move.trim()
                        });
                    }
                    this.lastMoveTimestamp = timestamp;
                }
            }
        }
        else if (eventType == 0x04) { // FACELETS
            let serial = msg.getBitWord(4, 8);
            if (this.lastSerial == -1)
                this.lastSerial = serial;
            // Corner/Edge Permutation/Orientation
            let cp = [];
            let co = [];
            let ep = [];
            let eo = [];
            // Corners
            for (let i = 0; i < 7; i++) {
                cp.push(msg.getBitWord(12 + i * 3, 3));
                co.push(msg.getBitWord(33 + i * 2, 2));
            }
            cp.push(28 - sum(cp));
            co.push((3 - (sum(co) % 3)) % 3);
            // Edges
            for (let i = 0; i < 11; i++) {
                ep.push(msg.getBitWord(47 + i * 4, 4));
                eo.push(msg.getBitWord(91 + i, 1));
            }
            ep.push(66 - sum(ep));
            eo.push((2 - (sum(eo) % 2)) % 2);
            cubeEvents.push({
                type: "FACELETS",
                serial: serial,
                timestamp: timestamp,
                facelets: toKociembaFacelets(cp, co, ep, eo),
                state: {
                    CP: cp,
                    CO: co,
                    EP: ep,
                    EO: eo
                },
            });
        }
        else if (eventType == 0x05) { // HARDWARE
            let hwMajor = msg.getBitWord(8, 8);
            let hwMinor = msg.getBitWord(16, 8);
            let swMajor = msg.getBitWord(24, 8);
            let swMinor = msg.getBitWord(32, 8);
            let gyroSupported = msg.getBitWord(104, 1);
            let hardwareName = '';
            for (var i = 0; i < 8; i++) {
                hardwareName += String.fromCharCode(msg.getBitWord(i * 8 + 40, 8));
            }
            cubeEvents.push({
                type: "HARDWARE",
                timestamp: timestamp,
                hardwareName: hardwareName,
                hardwareVersion: `${hwMajor}.${hwMinor}`,
                softwareVersion: `${swMajor}.${swMinor}`,
                gyroSupported: !!gyroSupported
            });
        }
        else if (eventType == 0x09) { // BATTERY
            let batteryLevel = msg.getBitWord(8, 8);
            cubeEvents.push({
                type: "BATTERY",
                timestamp: timestamp,
                batteryLevel: Math.min(batteryLevel, 100)
            });
        }
        else if (eventType == 0x0D) { // DISCONNECT
            conn.disconnect();
        }
        return cubeEvents;
    }
}
/**
 * Driver implementation for GAN Gen3 protocol, supported cubes:
 *  - GAN356 i Carry 2
 */
class GanGen3ProtocolDriver {
    constructor() {
        this.serial = -1;
        this.lastSerial = -1;
        this.lastLocalTimestamp = null;
        this.moveBuffer = [];
    }
    createCommandMessage(command) {
        var msg = new Uint8Array(16).fill(0);
        switch (command.type) {
            case 'REQUEST_FACELETS':
                msg.set([0x68, 0x01]);
                break;
            case 'REQUEST_HARDWARE':
                msg.set([0x68, 0x04]);
                break;
            case 'REQUEST_BATTERY':
                msg.set([0x68, 0x07]);
                break;
            case 'REQUEST_RESET':
                msg.set([0x68, 0x05, 0x05, 0x39, 0x77, 0x00, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0x00, 0x00, 0x00]);
                break;
            default:
                msg = undefined;
        }
        return msg;
    }
    /** Private cube command for requesting move history */
    async requestMoveHistory(conn, serial, count) {
        var msg = new Uint8Array(16).fill(0);
        // Move history response data is byte-aligned, and moves always starting with near-ceil odd serial number, regardless of requested.
        // Adjust serial and count to get odd serial aligned history window with even number of moves inside.
        if (serial % 2 == 0)
            serial = (serial - 1) & 0xFF;
        if (count % 2 == 1)
            count++;
        // Never overflow requested history window beyond the serial number cycle edge 255 -> 0.
        // Because due to iCarry2 firmware bug the moves beyond the edge will be spoofed with 'D' (just zero bytes).
        count = Math.min(count, serial + 1);
        msg.set([0x68, 0x03, serial, 0, count, 0]);
        return conn.sendCommandMessage(msg).catch(() => {
            // We can safely suppress and ignore possible GATT write errors, requestMoveHistory command is automatically retried on next move event
        });
    }
    /**
     * Evict move events from FIFO buffer until missing move event detected
     * In case of missing move, and if connection is provided, submit request for move history to fill gap in buffer
     */
    async evictMoveBuffer(conn) {
        var evictedEvents = [];
        while (this.moveBuffer.length > 0) {
            let bufferHead = this.moveBuffer[0];
            let diff = this.lastSerial == -1 ? 1 : (bufferHead.serial - this.lastSerial) & 0xFF;
            if (diff > 1) {
                if (conn) {
                    await this.requestMoveHistory(conn, bufferHead.serial, diff);
                }
                break;
            }
            else {
                evictedEvents.push(this.moveBuffer.shift());
                this.lastSerial = bufferHead.serial;
            }
        }
        // Probably something went wrong and buffer is no longer evicted, so forcibly disconnect the cube
        if (conn && this.moveBuffer.length > 16) {
            conn.disconnect();
        }
        return evictedEvents;
    }
    /**
     * Check if circular serial number (modulo 256) fits into (start,end) serial number range.
     * By default range is open, set closedStart / closedEnd to make it closed.
     */
    isSerialInRange(start, end, serial, closedStart = false, closedEnd = false) {
        return ((end - start) & 0xFF) >= ((serial - start) & 0xFF)
            && (closedStart || ((start - serial) & 0xFF) > 0)
            && (closedEnd || ((end - serial) & 0xFF) > 0);
    }
    /** Used to inject missed moves to FIFO buffer */
    injectMissedMoveToBuffer(move) {
        if (move.type == "MOVE") {
            if (this.moveBuffer.length > 0) {
                var bufferHead = this.moveBuffer[0];
                // Skip if move event with the same serial already in the buffer
                if (this.moveBuffer.some(e => e.type == "MOVE" && e.serial == move.serial))
                    return;
                // Skip if move serial does not fit in range between last evicted event and event on buffer head, i.e. event must be one of missed
                if (!this.isSerialInRange(this.lastSerial, bufferHead.serial, move.serial))
                    return;
                // Move history events should be injected in reverse order, so just put suitable event on buffer head
                if (move.serial == ((bufferHead.serial - 1) & 0xFF)) {
                    this.moveBuffer.unshift(move);
                }
            }
            else {
                // This case happens when lost move is recovered using periodic 
                // facelets state event, and being inserted into the empty buffer.
                if (this.isSerialInRange(this.lastSerial, this.serial, move.serial, false, true)) {
                    this.moveBuffer.unshift(move);
                }
            }
        }
    }
    /** Used in response to periodic facelets event to check if any moves missed */
    async checkIfMoveMissed(conn) {
        let diff = (this.serial - this.lastSerial) & 0xFF;
        if (diff > 0) {
            if (this.serial != 0) { // Constraint to avoid iCarry2 firmware bug with facelets state event at 255 move counter
                let bufferHead = this.moveBuffer[0];
                let startSerial = bufferHead ? bufferHead.serial : (this.serial + 1) & 0xFF;
                await this.requestMoveHistory(conn, startSerial, diff + 1);
            }
        }
    }
    async handleStateEvent(conn, eventMessage) {
        var timestamp = now();
        var cubeEvents = [];
        var msg = new GanProtocolMessageView(eventMessage);
        var magic = msg.getBitWord(0, 8);
        var eventType = msg.getBitWord(8, 8);
        var dataLength = msg.getBitWord(16, 8);
        if (magic == 0x55 && dataLength > 0) {
            if (eventType == 0x01) { // MOVE
                if (this.lastSerial != -1) { // Accept move events only after first facelets state event received
                    this.lastLocalTimestamp = timestamp;
                    let cubeTimestamp = msg.getBitWord(24, 32, true);
                    let serial = this.serial = msg.getBitWord(56, 16, true);
                    let direction = msg.getBitWord(72, 2);
                    let face = [2, 32, 8, 1, 16, 4].indexOf(msg.getBitWord(74, 6));
                    let move = "URFDLB".charAt(face) + " '".charAt(direction);
                    // put move event into FIFO buffer
                    if (face >= 0) {
                        this.moveBuffer.push({
                            type: "MOVE",
                            serial: serial,
                            timestamp: timestamp,
                            localTimestamp: timestamp,
                            cubeTimestamp: cubeTimestamp,
                            face: face,
                            direction: direction,
                            move: move.trim()
                        });
                    }
                    // evict move events from FIFO buffer
                    cubeEvents = await this.evictMoveBuffer(conn);
                }
            }
            else if (eventType == 0x06) { // MOVE_HISTORY
                let startSerial = msg.getBitWord(24, 8);
                let count = (dataLength - 1) * 2;
                // inject missed moves into FIFO buffer
                for (let i = 0; i < count; i++) {
                    let face = [1, 5, 3, 0, 4, 2].indexOf(msg.getBitWord(32 + 4 * i, 3));
                    let direction = msg.getBitWord(35 + 4 * i, 1);
                    if (face >= 0) {
                        let move = "URFDLB".charAt(face) + " '".charAt(direction);
                        this.injectMissedMoveToBuffer({
                            type: "MOVE",
                            serial: (startSerial - i) & 0xFF,
                            timestamp: timestamp,
                            localTimestamp: null, // Missed and recovered events has no meaningfull local timestamps
                            cubeTimestamp: null, // Cube hardware timestamp for missed move you should interpolate using cubeTimestampLinearFit
                            face: face,
                            direction: direction,
                            move: move.trim()
                        });
                    }
                }
                // evict move events from FIFO buffer
                cubeEvents = await this.evictMoveBuffer();
            }
            else if (eventType == 0x02) { // FACELETS
                let serial = this.serial = msg.getBitWord(24, 16, true);
                // Also check and recovery missed moves using periodic facelets event sent by cube
                if (this.lastSerial != -1) {
                    // Debounce the facelet event if there are active cube moves
                    if (this.lastLocalTimestamp != null && (timestamp - this.lastLocalTimestamp) > 500) {
                        await this.checkIfMoveMissed(conn);
                    }
                }
                if (this.lastSerial == -1)
                    this.lastSerial = serial;
                // Corner/Edge Permutation/Orientation
                let cp = [];
                let co = [];
                let ep = [];
                let eo = [];
                // Corners
                for (let i = 0; i < 7; i++) {
                    cp.push(msg.getBitWord(40 + i * 3, 3));
                    co.push(msg.getBitWord(61 + i * 2, 2));
                }
                cp.push(28 - sum(cp));
                co.push((3 - (sum(co) % 3)) % 3);
                // Edges
                for (let i = 0; i < 11; i++) {
                    ep.push(msg.getBitWord(77 + i * 4, 4));
                    eo.push(msg.getBitWord(121 + i, 1));
                }
                ep.push(66 - sum(ep));
                eo.push((2 - (sum(eo) % 2)) % 2);
                cubeEvents.push({
                    type: "FACELETS",
                    serial: serial,
                    timestamp: timestamp,
                    facelets: toKociembaFacelets(cp, co, ep, eo),
                    state: {
                        CP: cp,
                        CO: co,
                        EP: ep,
                        EO: eo
                    },
                });
            }
            else if (eventType == 0x07) { // HARDWARE
                let swMajor = msg.getBitWord(72, 4);
                let swMinor = msg.getBitWord(76, 4);
                let hwMajor = msg.getBitWord(80, 4);
                let hwMinor = msg.getBitWord(84, 4);
                let hardwareName = '';
                for (var i = 0; i < 5; i++) {
                    hardwareName += String.fromCharCode(msg.getBitWord(i * 8 + 32, 8));
                }
                cubeEvents.push({
                    type: "HARDWARE",
                    timestamp: timestamp,
                    hardwareName: hardwareName,
                    hardwareVersion: `${hwMajor}.${hwMinor}`,
                    softwareVersion: `${swMajor}.${swMinor}`,
                    gyroSupported: false
                });
            }
            else if (eventType == 0x10) { // BATTERY
                let batteryLevel = msg.getBitWord(24, 8);
                cubeEvents.push({
                    type: "BATTERY",
                    timestamp: timestamp,
                    batteryLevel: Math.min(batteryLevel, 100)
                });
            }
            else if (eventType == 0x11) { // DISCONNECT
                conn.disconnect();
            }
        }
        return cubeEvents;
    }
}
/**
 * Driver implementation for GAN Gen4 protocol, supported cubes:
 *  - GAN12 ui Maglev
 *  - GAN14 ui FreePlay
 */
class GanGen4ProtocolDriver {
    constructor() {
        this.serial = -1;
        this.lastSerial = -1;
        this.lastLocalTimestamp = null;
        this.moveBuffer = [];
        // Used to store partial result acquired from hardware info events
        this.hwInfo = {};
        /** Set when we have seen at least one 0xEC GYRO packet this connection (not cleared on REQUEST_HARDWARE). */
        this.gyroObserved = false;
        /** Set when a full HARDWARE snapshot was emitted for the current hwInfo assembly; reset when REQUEST_HARDWARE clears hwInfo. */
        this.hardwareInfoEmitted = false;
    }
    createCommandMessage(command) {
        var msg = new Uint8Array(20).fill(0);
        switch (command.type) {
            case 'REQUEST_FACELETS':
                msg.set([0xDD, 0x04, 0x00, 0xED, 0x00, 0x00]);
                break;
            case 'REQUEST_HARDWARE':
                this.hwInfo = {};
                this.hardwareInfoEmitted = false;
                msg.set([0xDF, 0x03, 0x00, 0x00, 0x00]);
                break;
            case 'REQUEST_BATTERY':
                msg.set([0xDD, 0x04, 0x00, 0xEF, 0x00, 0x00]);
                break;
            case 'REQUEST_RESET':
                msg.set([0xD2, 0x0D, 0x05, 0x39, 0x77, 0x00, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0x00, 0x00, 0x00]);
                break;
            default:
                msg = undefined;
        }
        return msg;
    }
    buildHardwareEvent(timestamp) {
        return {
            type: "HARDWARE",
            timestamp: timestamp,
            hardwareName: this.hwInfo[0xFC],
            hardwareVersion: this.hwInfo[0xFE],
            softwareVersion: this.hwInfo[0xFD],
            productDate: this.hwInfo[0xFA],
            gyroSupported: this.gyroObserved
        };
    }
    /** Private cube command for requesting move history */
    async requestMoveHistory(conn, serial, count) {
        var msg = new Uint8Array(20).fill(0);
        // Move history response data is byte-aligned, and moves always starting with near-ceil odd serial number, regardless of requested.
        // Adjust serial and count to get odd serial aligned history window with even number of moves inside.
        if (serial % 2 == 0)
            serial = (serial - 1) & 0xFF;
        if (count % 2 == 1)
            count++;
        // Never overflow requested history window beyond the serial number cycle edge 255 -> 0.
        // Because due to firmware bug the moves beyond the edge will be spoofed with 'D' (just zero bytes).
        count = Math.min(count, serial + 1);
        msg.set([0xD1, 0x04, serial, 0, count, 0]);
        return conn.sendCommandMessage(msg).catch(() => {
            // We can safely suppress and ignore possible GATT write errors, requestMoveHistory command is automatically retried on next move event
        });
    }
    /**
     * Evict move events from FIFO buffer until missing move event detected
     * In case of missing move, and if connection is provided, submit request for move history to fill gap in buffer
     */
    async evictMoveBuffer(conn) {
        var evictedEvents = [];
        while (this.moveBuffer.length > 0) {
            let bufferHead = this.moveBuffer[0];
            let diff = this.lastSerial == -1 ? 1 : (bufferHead.serial - this.lastSerial) & 0xFF;
            if (diff > 1) {
                if (conn) {
                    await this.requestMoveHistory(conn, bufferHead.serial, diff);
                }
                break;
            }
            else {
                evictedEvents.push(this.moveBuffer.shift());
                this.lastSerial = bufferHead.serial;
            }
        }
        // Probably something went wrong and buffer is no longer evicted, so forcibly disconnect the cube
        if (conn && this.moveBuffer.length > 16) {
            conn.disconnect();
        }
        return evictedEvents;
    }
    /**
     * Check if circular serial number (modulo 256) fits into (start,end) serial number range.
     * By default range is open, set closedStart / closedEnd to make it closed.
     */
    isSerialInRange(start, end, serial, closedStart = false, closedEnd = false) {
        return ((end - start) & 0xFF) >= ((serial - start) & 0xFF)
            && (closedStart || ((start - serial) & 0xFF) > 0)
            && (closedEnd || ((end - serial) & 0xFF) > 0);
    }
    /** Used to inject missed moves to FIFO buffer */
    injectMissedMoveToBuffer(move) {
        if (move.type == "MOVE") {
            if (this.moveBuffer.length > 0) {
                var bufferHead = this.moveBuffer[0];
                // Skip if move event with the same serial already in the buffer
                if (this.moveBuffer.some(e => e.type == "MOVE" && e.serial == move.serial))
                    return;
                // Skip if move serial does not fit in range between last evicted event and event on buffer head, i.e. event must be one of missed
                if (!this.isSerialInRange(this.lastSerial, bufferHead.serial, move.serial))
                    return;
                // Move history events should be injected in reverse order, so just put suitable event on buffer head
                if (move.serial == ((bufferHead.serial - 1) & 0xFF)) {
                    this.moveBuffer.unshift(move);
                }
            }
            else {
                // This case happens when lost move is recovered using periodic 
                // facelets state event, and being inserted into the empty buffer.
                if (this.isSerialInRange(this.lastSerial, this.serial, move.serial, false, true)) {
                    this.moveBuffer.unshift(move);
                }
            }
        }
    }
    /** Used in response to periodic facelets event to check if any moves missed */
    async checkIfMoveMissed(conn) {
        let diff = (this.serial - this.lastSerial) & 0xFF;
        if (diff > 0) {
            if (this.serial != 0) { // Constraint to avoid firmware bug with facelets state event at 255 move counter
                let bufferHead = this.moveBuffer[0];
                let startSerial = bufferHead ? bufferHead.serial : (this.serial + 1) & 0xFF;
                await this.requestMoveHistory(conn, startSerial, diff + 1);
            }
        }
    }
    async handleStateEvent(conn, eventMessage) {
        var timestamp = now();
        var cubeEvents = [];
        var msg = new GanProtocolMessageView(eventMessage);
        var eventType = msg.getBitWord(0, 8);
        var dataLength = msg.getBitWord(8, 8);
        if (eventType == 0x01) { // MOVE
            if (this.lastSerial != -1) { // Accept move events only after first facelets state event received
                // One BLE notification may contain multiple MOVE chunks (72 bits each). Only reading the first
                // chunk drops later face turns (common on slice moves) until MOVE_HISTORY catches up
                const msgBitLen = eventMessage.length * 8;
                let off = 0;
                while (off + 72 <= msgBitLen && msg.getBitWord(off, 8) === 0x01) {
                    let cubeTimestamp = msg.getBitWord(off + 16, 32, true);
                    let serial = msg.getBitWord(off + 48, 16, true);
                    this.serial = serial;
                    let direction = msg.getBitWord(off + 64, 2);
                    let face = [2, 32, 8, 1, 16, 4].indexOf(msg.getBitWord(off + 66, 6));
                    let move = "URFDLB".charAt(face) + " '".charAt(direction);
                    if (face < 0) {
                        break;
                    }
                    this.moveBuffer.push({
                        type: "MOVE",
                        serial: serial,
                        timestamp: timestamp,
                        localTimestamp: timestamp,
                        cubeTimestamp: cubeTimestamp,
                        face: face,
                        direction: direction,
                        move: move.trim()
                    });
                    this.lastLocalTimestamp = timestamp;
                    off += 72;
                }
                // evict move events from FIFO buffer
                cubeEvents = await this.evictMoveBuffer(conn);
            }
        }
        else if (eventType == 0xD1) { // MOVE_HISTORY
            let startSerial = msg.getBitWord(16, 8);
            let count = (dataLength - 1) * 2;
            // inject missed moves into FIFO buffer
            for (let i = 0; i < count; i++) {
                let face = [1, 5, 3, 0, 4, 2].indexOf(msg.getBitWord(24 + 4 * i, 3));
                let direction = msg.getBitWord(27 + 4 * i, 1);
                if (face >= 0) {
                    let move = "URFDLB".charAt(face) + " '".charAt(direction);
                    this.injectMissedMoveToBuffer({
                        type: "MOVE",
                        serial: (startSerial - i) & 0xFF,
                        timestamp: timestamp,
                        localTimestamp: null, // Missed and recovered events has no meaningfull local timestamps
                        cubeTimestamp: null, // Cube hardware timestamp for missed move you should interpolate using cubeTimestampLinearFit
                        face: face,
                        direction: direction,
                        move: move.trim()
                    });
                }
            }
            // evict move events from FIFO buffer
            cubeEvents = await this.evictMoveBuffer();
        }
        else if (eventType == 0xED) { // FACELETS
            let serial = this.serial = msg.getBitWord(16, 16, true);
            // Also check and recovery missed moves using periodic facelets event sent by cube
            if (this.lastSerial != -1) {
                // Debounce the facelet event if there are active cube moves
                if (this.lastLocalTimestamp != null && (timestamp - this.lastLocalTimestamp) > 500) {
                    await this.checkIfMoveMissed(conn);
                }
            }
            if (this.lastSerial == -1)
                this.lastSerial = serial;
            // Corner/Edge Permutation/Orientation
            let cp = [];
            let co = [];
            let ep = [];
            let eo = [];
            // Corners
            for (let i = 0; i < 7; i++) {
                cp.push(msg.getBitWord(32 + i * 3, 3));
                co.push(msg.getBitWord(53 + i * 2, 2));
            }
            cp.push(28 - sum(cp));
            co.push((3 - (sum(co) % 3)) % 3);
            // Edges
            for (let i = 0; i < 11; i++) {
                ep.push(msg.getBitWord(69 + i * 4, 4));
                eo.push(msg.getBitWord(113 + i, 1));
            }
            ep.push(66 - sum(ep));
            eo.push((2 - (sum(eo) % 2)) % 2);
            cubeEvents.push({
                type: "FACELETS",
                serial: serial,
                timestamp: timestamp,
                facelets: toKociembaFacelets(cp, co, ep, eo),
                state: {
                    CP: cp,
                    CO: co,
                    EP: ep,
                    EO: eo
                },
            });
        }
        else if (eventType >= 0xFA && eventType <= 0xFE) { // HARDWARE
            switch (eventType) {
                case 0xFA: // Product Date
                    let year = msg.getBitWord(24, 16, true);
                    let month = msg.getBitWord(40, 8);
                    let day = msg.getBitWord(48, 8);
                    this.hwInfo[eventType] = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                    break;
                case 0xFC: // Hardware Name
                    this.hwInfo[eventType] = '';
                    for (var i = 0; i < dataLength - 1; i++) {
                        this.hwInfo[eventType] += String.fromCharCode(msg.getBitWord(i * 8 + 24, 8));
                    }
                    break;
                case 0xFD: // Software Version
                    let swMajor = msg.getBitWord(24, 4);
                    let swMinor = msg.getBitWord(28, 4);
                    this.hwInfo[eventType] = `${swMajor}.${swMinor}`;
                    break;
                case 0xFE: // Hardware Version
                    let hwMajor = msg.getBitWord(24, 4);
                    let hwMinor = msg.getBitWord(28, 4);
                    this.hwInfo[eventType] = `${hwMajor}.${hwMinor}`;
                    break;
            }
            if (Object.keys(this.hwInfo).length == 4) { // All fields are populated
                this.hardwareInfoEmitted = true;
                cubeEvents.push(this.buildHardwareEvent(timestamp));
            }
        }
        else if (eventType == 0xEC) { // GYRO
            const firstGyroThisSession = !this.gyroObserved;
            this.gyroObserved = true;
            // Orientation Quaternion
            let qw = msg.getBitWord(16, 16);
            let qx = msg.getBitWord(32, 16);
            let qy = msg.getBitWord(48, 16);
            let qz = msg.getBitWord(64, 16);
            // Angular Velocity
            let vx = msg.getBitWord(80, 4);
            let vy = msg.getBitWord(84, 4);
            let vz = msg.getBitWord(88, 4);
            cubeEvents.push({
                type: "GYRO",
                timestamp: timestamp,
                quaternion: {
                    x: (1 - (qx >> 15) * 2) * (qx & 0x7FFF) / 0x7FFF,
                    y: (1 - (qy >> 15) * 2) * (qy & 0x7FFF) / 0x7FFF,
                    z: (1 - (qz >> 15) * 2) * (qz & 0x7FFF) / 0x7FFF,
                    w: (1 - (qw >> 15) * 2) * (qw & 0x7FFF) / 0x7FFF
                },
                velocity: {
                    x: (1 - (vx >> 3) * 2) * (vx & 0x7),
                    y: (1 - (vy >> 3) * 2) * (vy & 0x7),
                    z: (1 - (vz >> 3) * 2) * (vz & 0x7)
                }
            });
            if (firstGyroThisSession && this.hardwareInfoEmitted && Object.keys(this.hwInfo).length == 4) {
                cubeEvents.push(this.buildHardwareEvent(timestamp));
            }
        }
        else if (eventType == 0xEF) { // BATTERY
            let batteryLevel = msg.getBitWord(8 + dataLength * 8, 8);
            cubeEvents.push({
                type: "BATTERY",
                timestamp: timestamp,
                batteryLevel: Math.min(batteryLevel, 100)
            });
        }
        else if (eventType == 0xEA) { // DISCONNECT
            conn.disconnect();
        }
        return cubeEvents;
    }
}

/** Iterate over all known GAN cube CICs to find Manufacturer Specific Data */
function getManufacturerDataBytes(manufacturerData) {
    // Workaround for Bluefy browser which may return raw DataView directly instead of Map
    if (manufacturerData instanceof DataView) {
        return new DataView(manufacturerData.buffer.slice(2, 11));
    }
    for (var id of GAN_CIC_LIST) {
        if (manufacturerData.has(id)) {
            return new DataView(manufacturerData.get(id).buffer.slice(0, 9));
        }
    }
    return;
}
/** Extract MAC from last 6 bytes of Manufacturer Specific Data */
function extractMAC(manufacturerData) {
    var mac = [];
    var dataView = getManufacturerDataBytes(manufacturerData);
    if (dataView && dataView.byteLength >= 6) {
        for (let i = 1; i <= 6; i++) {
            mac.push(dataView.getUint8(dataView.byteLength - i).toString(16).toUpperCase().padStart(2, "0"));
        }
    }
    return mac.join(":");
}
/** If browser supports Web Bluetooth watchAdvertisements() API, try to retrieve MAC address automatically */
async function autoRetrieveMacAddress(device) {
    return new Promise((resolve) => {
        if (typeof device.watchAdvertisements != 'function') {
            resolve(null);
        }
        var abortController = new AbortController();
        var onAdvEvent = (evt) => {
            device.removeEventListener("advertisementreceived", onAdvEvent);
            abortController.abort();
            var mac = extractMAC(evt.manufacturerData);
            resolve(mac || null);
        };
        var onAbort = () => {
            device.removeEventListener("advertisementreceived", onAdvEvent);
            abortController.abort();
            resolve(null);
        };
        device.addEventListener("advertisementreceived", onAdvEvent);
        device.watchAdvertisements({ signal: abortController.signal }).catch(onAbort);
        setTimeout(onAbort, 5000);
    });
}
function hasGanGen1Profile$1(serviceUuids) {
    const primary = normalizeUuid(GAN_GEN1_PRIMARY_SERVICE);
    const deviceInfo = normalizeUuid(GAN_GEN1_DEVICE_INFO_SERVICE);
    return serviceUuids.has(primary) && serviceUuids.has(deviceInfo);
}
/**
 * Initiate new connection with the GAN Smart Cube device
 * @param customMacAddressProvider Optional custom provider for cube MAC address
 * @returns Object representing connection API and state
 */
async function connectGanCube(customMacAddressProvider) {
    // Request user for the bluetooth device (popup selection dialog)
    const nameFilters = [
        { namePrefix: "GAN" },
        { namePrefix: "MG" },
        { namePrefix: "AiCube" },
    ];
    const cicFilters = GAN_CIC_LIST.map((companyIdentifier) => ({
        manufacturerData: [{ companyIdentifier }],
    }));
    var device = await navigator.bluetooth.requestDevice({
        filters: [...nameFilters, ...cicFilters],
        optionalServices: [
            GAN_GEN1_PRIMARY_SERVICE,
            GAN_GEN1_DEVICE_INFO_SERVICE,
            GAN_GEN2_SERVICE,
            GAN_GEN3_SERVICE,
            GAN_GEN4_SERVICE,
            "0000180a-0000-1000-8000-00805f9b34fb",
            "00001800-0000-1000-8000-00805f9b34fb",
        ],
    });
    // Connect to GATT and get primary services
    var gatt = await device.gatt.connect();
    var services = await gatt.getPrimaryServices();
    const serviceUuidSet = new Set(services.map((s) => normalizeUuid(s.uuid)));
    if (hasGanGen1Profile$1(serviceUuidSet)) {
        return GanGen1CubeConnection.create(device);
    }
    // Retrieve cube MAC address needed for key salting
    var mac = customMacAddressProvider && await customMacAddressProvider(device, false)
        || await autoRetrieveMacAddress(device)
        || customMacAddressProvider && await customMacAddressProvider(device, true);
    if (!mac)
        throw new Error('Unable to determine cube MAC address, connection is not possible!');
    device.mac = mac;
    // Create encryption salt from MAC address bytes placed in reverse order
    var salt = macStringToSaltOrThrow(mac);
    const g2 = normalizeUuid(GAN_GEN2_SERVICE);
    const g3 = normalizeUuid(GAN_GEN3_SERVICE);
    const g4 = normalizeUuid(GAN_GEN4_SERVICE);
    let pick = null;
    if (serviceUuidSet.has(g2))
        pick = 'g2';
    else if (serviceUuidSet.has(g3))
        pick = 'g3';
    else if (serviceUuidSet.has(g4))
        pick = 'g4';
    var conn = null;
    // Resolve type of connected cube device and setup appropriate encryption / protocol driver
    if (pick === 'g2') {
        const service = await gatt.getPrimaryService(GAN_GEN2_SERVICE);
        let commandCharacteristic = await service.getCharacteristic(GAN_GEN2_COMMAND_CHARACTERISTIC);
        let stateCharacteristic = await service.getCharacteristic(GAN_GEN2_STATE_CHARACTERISTIC);
        let key = device.name?.startsWith('AiCube') ? GAN_ENCRYPTION_KEYS[1] : GAN_ENCRYPTION_KEYS[0];
        let encrypter = new GanGen2CubeEncrypter(new Uint8Array(key.key), new Uint8Array(key.iv), salt);
        let driver = new GanGen2ProtocolDriver();
        conn = await GanCubeClassicConnection.create(device, commandCharacteristic, stateCharacteristic, encrypter, driver, {
            validateDecrypted: isValidGanGen2Packet,
        });
    }
    else if (pick === 'g3') {
        const service = await gatt.getPrimaryService(GAN_GEN3_SERVICE);
        let commandCharacteristic = await service.getCharacteristic(GAN_GEN3_COMMAND_CHARACTERISTIC);
        let stateCharacteristic = await service.getCharacteristic(GAN_GEN3_STATE_CHARACTERISTIC);
        let key = GAN_ENCRYPTION_KEYS[0];
        let encrypter = new GanGen3CubeEncrypter(new Uint8Array(key.key), new Uint8Array(key.iv), salt);
        let driver = new GanGen3ProtocolDriver();
        conn = await GanCubeClassicConnection.create(device, commandCharacteristic, stateCharacteristic, encrypter, driver, {
            validateDecrypted: isValidGanGen3Packet,
        });
    }
    else if (pick === 'g4') {
        const service = await gatt.getPrimaryService(GAN_GEN4_SERVICE);
        let commandCharacteristic = await service.getCharacteristic(GAN_GEN4_COMMAND_CHARACTERISTIC);
        let stateCharacteristic = await service.getCharacteristic(GAN_GEN4_STATE_CHARACTERISTIC);
        let key = GAN_ENCRYPTION_KEYS[0];
        let encrypter = new GanGen4CubeEncrypter(new Uint8Array(key.key), new Uint8Array(key.iv), salt);
        let driver = new GanGen4ProtocolDriver();
        conn = await GanCubeClassicConnection.create(device, commandCharacteristic, stateCharacteristic, encrypter, driver, {
            validateDecrypted: isValidGanGen4Packet,
        });
    }
    if (!conn)
        throw new Error("Can't find target BLE services - wrong or unsupported cube device model");
    return conn;
}

const STORAGE_PREFIX = 'smartcube-ble-mac:';
function getCachedMacForDevice(device) {
    if (typeof localStorage === 'undefined') {
        return null;
    }
    try {
        return localStorage.getItem(STORAGE_PREFIX + device.id);
    }
    catch {
        return null;
    }
}
function setCachedMacForDevice(device, mac) {
    if (typeof localStorage === 'undefined') {
        return;
    }
    try {
        localStorage.setItem(STORAGE_PREFIX + device.id, mac);
    }
    catch {
        /* ignore quota */
    }
}
function removeCachedMacForDevice(device) {
    if (typeof localStorage === 'undefined') {
        return;
    }
    try {
        localStorage.removeItem(STORAGE_PREFIX + device.id);
    }
    catch {
        /* ignore */
    }
}
function mergeManufacturerDataInto(acc, mf) {
    if (!mf || typeof mf.keys !== 'function') {
        return;
    }
    for (const id of mf.keys()) {
        const v = mf.get(id);
        if (v) {
            acc.set(id, new DataView(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
        }
    }
}
/**
 * Wait for manufacturer data from advertisements (single shared listener).
 * Merges all packets until timeout: the first BLE advertisement often has an empty
 * manufacturerData map; MAC-bearing data appears on later frames.
 */
async function waitForManufacturerData(device, timeoutMs = 5000) {
    if (typeof device.watchAdvertisements !== 'function') {
        return null;
    }
    const name = (device.name || '').trim();
    /** MoYu32-style names rarely expose useful MF in the picker; keep connect snappy. */
    const emptyFirstAdvExit = name.startsWith('WCU_');
    return new Promise((resolve) => {
        const abortController = new AbortController();
        const merged = new Map();
        let sawAdvertisement = false;
        let finished = false;
        const cleanup = () => {
            device.removeEventListener('advertisementreceived', onAdvEvent);
            abortController.abort();
            clearTimeout(maxTimer);
        };
        const finish = (value) => {
            if (finished) {
                return;
            }
            finished = true;
            cleanup();
            resolve(value);
        };
        const onAdvEvent = (evt) => {
            const adv = evt;
            mergeManufacturerDataInto(merged, adv.manufacturerData ?? null);
            const isFirstAdv = !sawAdvertisement;
            sawAdvertisement = true;
            if (merged.size > 0) {
                finish(merged);
                return;
            }
            if (emptyFirstAdvExit && isFirstAdv) {
                finish(null);
            }
        };
        const maxTimer = setTimeout(() => {
            finish(merged.size > 0 ? merged : null);
        }, timeoutMs);
        device.addEventListener('advertisementreceived', onAdvEvent);
        device.watchAdvertisements({ signal: abortController.signal }).catch(() => {
            clearTimeout(maxTimer);
            finish(null);
        });
    });
}
/** GAN-style MAC from manufacturer data (last 6 bytes, reversed order in payload). */
function macFromGanManufacturerData(mf) {
    function getBytes(manufacturerData) {
        if (manufacturerData instanceof DataView) {
            return new DataView(manufacturerData.buffer.slice(2, 11));
        }
        for (const id of GAN_CIC_LIST) {
            if (manufacturerData.has(id)) {
                return new DataView(manufacturerData.get(id).buffer.slice(0, 9));
            }
        }
        return undefined;
    }
    const dataView = getBytes(mf);
    if (!dataView || dataView.byteLength < 6) {
        return null;
    }
    const mac = [];
    for (let i = 1; i <= 6; i++) {
        mac.push(dataView.getUint8(dataView.byteLength - i).toString(16).toUpperCase().padStart(2, '0'));
    }
    return mac.join(':');
}

const protocolRegistry = [];
function registerProtocol(protocol) {
    protocolRegistry.push(protocol);
}
function getRegisteredProtocols() {
    return protocolRegistry;
}

const DEFAULT_GAN_CAPABILITIES = {
    gyroscope: true,
    battery: true,
    facelets: true,
    hardware: true,
    reset: true,
};
const GAN_GEN1_CAPABILITIES = {
    gyroscope: true,
    battery: true,
    facelets: true,
    hardware: false,
    reset: false,
};
const GAN_GEN1_PROTOCOL = { id: 'gan-gen1', name: 'GAN Gen1' };
const GAN_GEN2_PROTOCOL = { id: 'gan-gen2', name: 'GAN Gen2' };
const GAN_GEN3_PROTOCOL = { id: 'gan-gen3', name: 'GAN Gen3' };
const GAN_GEN4_PROTOCOL = { id: 'gan-gen4', name: 'GAN Gen4' };
function ganEventToSmartEvent(event) {
    switch (event.type) {
        case "MOVE":
            return {
                timestamp: event.timestamp,
                type: "MOVE",
                face: event.face,
                direction: event.direction,
                move: event.move,
                localTimestamp: event.localTimestamp,
                cubeTimestamp: event.cubeTimestamp
            };
        case "FACELETS":
            return {
                timestamp: event.timestamp,
                type: "FACELETS",
                facelets: event.facelets
            };
        case "GYRO":
            return {
                timestamp: event.timestamp,
                type: "GYRO",
                quaternion: event.quaternion,
                velocity: event.velocity
            };
        case "BATTERY":
            return {
                timestamp: event.timestamp,
                type: "BATTERY",
                batteryLevel: event.batteryLevel
            };
        case "HARDWARE":
            return {
                timestamp: event.timestamp,
                type: "HARDWARE",
                hardwareName: event.hardwareName,
                softwareVersion: event.softwareVersion,
                hardwareVersion: event.hardwareVersion,
                productDate: event.productDate,
                gyroSupported: event.gyroSupported
            };
        case "DISCONNECT":
            return {
                timestamp: event.timestamp,
                type: "DISCONNECT"
            };
    }
}
function hasGanGen1Profile(serviceUuids) {
    const primary = normalizeUuid(GAN_GEN1_PRIMARY_SERVICE);
    const deviceInfo = normalizeUuid(GAN_GEN1_DEVICE_INFO_SERVICE);
    return serviceUuids.has(primary) && serviceUuids.has(deviceInfo);
}
class GanSmartCubeConnection {
    constructor(ganConn, mac, protocol, capabilities) {
        this.lastBatteryLevel = null;
        this.forceNextBatteryEmission = false;
        this.ganConn = ganConn;
        this.deviceMac = mac;
        this.protocol = protocol;
        this.capabilities = capabilities ?? DEFAULT_GAN_CAPABILITIES;
        this.events$ = new Subject();
        ganConn.events$.subscribe({
            next: (event) => {
                if (event.type === 'BATTERY') {
                    const batteryLevel = Math.min(100, Math.max(0, Math.round(event.batteryLevel)));
                    const forceEmission = this.forceNextBatteryEmission;
                    this.forceNextBatteryEmission = false;
                    if (!forceEmission && this.lastBatteryLevel === batteryLevel) {
                        return;
                    }
                    this.lastBatteryLevel = batteryLevel;
                    this.events$.next({
                        timestamp: event.timestamp,
                        type: 'BATTERY',
                        batteryLevel,
                    });
                    return;
                }
                this.events$.next(ganEventToSmartEvent(event));
            },
            complete: () => this.events$.complete(),
        });
    }
    get deviceName() {
        return this.ganConn.deviceName;
    }
    get deviceMAC() {
        return this.deviceMac;
    }
    async sendCommand(command) {
        if (command.type === 'REQUEST_BATTERY') {
            this.forceNextBatteryEmission = true;
        }
        return this.ganConn.sendCubeCommand(command);
    }
    async disconnect() {
        this.forceNextBatteryEmission = false;
        return this.ganConn.disconnect();
    }
}
async function connectGanDevice(device, macProvider, context) {
    const bleDevice = device;
    const gatt = device.gatt;
    if (!gatt.connected) {
        await gatt.connect();
    }
    const services = await gatt.getPrimaryServices();
    const serviceUuidSet = new Set(services.map((s) => normalizeUuid(s.uuid)));
    if (hasGanGen1Profile(serviceUuidSet)) {
        const gen1Conn = await GanGen1CubeConnection.create(device);
        return new GanSmartCubeConnection(gen1Conn, '', GAN_GEN1_PROTOCOL, GAN_GEN1_CAPABILITIES);
    }
    let mac = null;
    if (context?.advertisementManufacturerData) {
        mac = macFromGanManufacturerData(context.advertisementManufacturerData);
    }
    mac = mac || getCachedMacForDevice(device);
    if (!mac && macProvider) {
        const r = await macProvider(device, false);
        if (r) {
            mac = r;
        }
    }
    if (!mac) {
        const mf = await waitForManufacturerData(device, 5000);
        if (mf) {
            mac = macFromGanManufacturerData(mf);
        }
    }
    if (!mac && macProvider) {
        const r = await macProvider(device, true);
        if (r) {
            mac = r;
        }
    }
    if (!mac) {
        throw new Error('Unable to determine cube MAC address, connection is not possible!');
    }
    bleDevice.mac = mac;
    const salt = macStringToSaltOrThrow(mac);
    const g2 = normalizeUuid(GAN_GEN2_SERVICE);
    const g3 = normalizeUuid(GAN_GEN3_SERVICE);
    const g4 = normalizeUuid(GAN_GEN4_SERVICE);
    let pick = null;
    if (serviceUuidSet.has(g2))
        pick = 'g2';
    else if (serviceUuidSet.has(g3))
        pick = 'g3';
    else if (serviceUuidSet.has(g4))
        pick = 'g4';
    let ganConn = null;
    if (pick === 'g2') {
        const service = await gatt.getPrimaryService(GAN_GEN2_SERVICE);
        const commandCharacteristic = await service.getCharacteristic(GAN_GEN2_COMMAND_CHARACTERISTIC);
        const stateCharacteristic = await service.getCharacteristic(GAN_GEN2_STATE_CHARACTERISTIC);
        const key = device.name?.startsWith('AiCube') ? GAN_ENCRYPTION_KEYS[1] : GAN_ENCRYPTION_KEYS[0];
        const encrypter = new GanGen2CubeEncrypter(new Uint8Array(key.key), new Uint8Array(key.iv), salt);
        const driver = new GanGen2ProtocolDriver();
        ganConn = await GanCubeClassicConnection.create(bleDevice, commandCharacteristic, stateCharacteristic, encrypter, driver, { validateDecrypted: isValidGanGen2Packet });
    }
    else if (pick === 'g3') {
        const service = await gatt.getPrimaryService(GAN_GEN3_SERVICE);
        const commandCharacteristic = await service.getCharacteristic(GAN_GEN3_COMMAND_CHARACTERISTIC);
        const stateCharacteristic = await service.getCharacteristic(GAN_GEN3_STATE_CHARACTERISTIC);
        const key = GAN_ENCRYPTION_KEYS[0];
        const encrypter = new GanGen3CubeEncrypter(new Uint8Array(key.key), new Uint8Array(key.iv), salt);
        const driver = new GanGen3ProtocolDriver();
        ganConn = await GanCubeClassicConnection.create(bleDevice, commandCharacteristic, stateCharacteristic, encrypter, driver, { validateDecrypted: isValidGanGen3Packet });
    }
    else if (pick === 'g4') {
        const service = await gatt.getPrimaryService(GAN_GEN4_SERVICE);
        const commandCharacteristic = await service.getCharacteristic(GAN_GEN4_COMMAND_CHARACTERISTIC);
        const stateCharacteristic = await service.getCharacteristic(GAN_GEN4_STATE_CHARACTERISTIC);
        const key = GAN_ENCRYPTION_KEYS[0];
        const encrypter = new GanGen4CubeEncrypter(new Uint8Array(key.key), new Uint8Array(key.iv), salt);
        const driver = new GanGen4ProtocolDriver();
        ganConn = await GanCubeClassicConnection.create(bleDevice, commandCharacteristic, stateCharacteristic, encrypter, driver, { validateDecrypted: isValidGanGen4Packet });
    }
    if (!ganConn) {
        throw new Error("Can't find target BLE services - wrong or unsupported cube device model");
    }
    return new GanSmartCubeConnection(ganConn, mac, pick === 'g2' ? GAN_GEN2_PROTOCOL : pick === 'g3' ? GAN_GEN3_PROTOCOL : GAN_GEN4_PROTOCOL);
}
const ganProtocol = {
    nameFilters: [{ namePrefix: 'GAN' }, { namePrefix: 'MG' }, { namePrefix: 'AiCube' }],
    optionalServices: [
        GAN_GEN1_PRIMARY_SERVICE,
        GAN_GEN1_DEVICE_INFO_SERVICE,
        GAN_GEN2_SERVICE,
        GAN_GEN3_SERVICE,
        GAN_GEN4_SERVICE,
    ],
    optionalManufacturerData: GAN_CIC_LIST,
    matchesDevice(device) {
        const name = device.name || '';
        return name.startsWith('GAN') || name.startsWith('MG') || name.startsWith('AiCube');
    },
    gattAffinity(serviceUuids, _device) {
        const g2 = normalizeUuid(GAN_GEN2_SERVICE);
        const g3 = normalizeUuid(GAN_GEN3_SERVICE);
        const g4 = normalizeUuid(GAN_GEN4_SERVICE);
        const g1Primary = normalizeUuid(GAN_GEN1_PRIMARY_SERVICE);
        const deviceInfo = normalizeUuid(GAN_GEN1_DEVICE_INFO_SERVICE);
        const bonus = serviceUuids.has(deviceInfo) ? 5 : 0;
        if (serviceUuids.has(g1Primary) && serviceUuids.has(deviceInfo)) {
            return 125 + bonus;
        }
        if (serviceUuids.has(g4)) {
            return 120 + bonus;
        }
        if (serviceUuids.has(g3)) {
            return 120 + bonus;
        }
        if (serviceUuids.has(g2)) {
            return 120 + bonus;
        }
        return 0;
    },
    connect: connectGanDevice
};
registerProtocol(ganProtocol);

const SOLVED_FACELET = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
const cFacelet = [
    [8, 9, 20], // URF
    [6, 18, 38], // UFL
    [0, 36, 47], // ULB
    [2, 45, 11], // UBR
    [29, 26, 15], // DFR
    [27, 44, 24], // DLF
    [33, 53, 42], // DBL
    [35, 17, 51] // DRB
];
const eFacelet = [
    [5, 10], // UR
    [7, 19], // UF
    [3, 37], // UL
    [1, 46], // UB
    [32, 16], // DR
    [28, 25], // DF
    [30, 43], // DL
    [34, 52], // DB
    [23, 12], // FR
    [21, 41], // FL
    [50, 39], // BL
    [48, 14] // BR
];
class CubieCube {
    constructor() {
        this.ca = [0, 1, 2, 3, 4, 5, 6, 7];
        this.ea = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
    }
    init(ca, ea) {
        this.ca = ca.slice();
        this.ea = ea.slice();
        return this;
    }
    static EdgeMult(a, b, prod) {
        for (let ed = 0; ed < 12; ed++) {
            prod.ea[ed] = a.ea[b.ea[ed] >> 1] ^ (b.ea[ed] & 1);
        }
    }
    static CornMult(a, b, prod) {
        for (let corn = 0; corn < 8; corn++) {
            const ori = ((a.ca[b.ca[corn] & 7] >> 3) + (b.ca[corn] >> 3)) % 3;
            prod.ca[corn] = (a.ca[b.ca[corn] & 7] & 7) | (ori << 3);
        }
    }
    static CubeMult(a, b, prod) {
        CubieCube.CornMult(a, b, prod);
        CubieCube.EdgeMult(a, b, prod);
    }
    toFaceCube(customCFacelet, customEFacelet) {
        const cf = customCFacelet || cFacelet;
        const ef = customEFacelet || eFacelet;
        const f = [];
        for (let i = 0; i < 54; i++) {
            f[i] = i;
        }
        for (let c = 0; c < 8; c++) {
            const j = this.ca[c] & 0x7;
            const ori = this.ca[c] >> 3;
            for (let n = 0; n < 3; n++) {
                f[cf[c][(n + ori) % 3]] = cf[j][n];
            }
        }
        for (let e = 0; e < 12; e++) {
            const j = this.ea[e] >> 1;
            const ori = this.ea[e] & 1;
            for (let n = 0; n < 2; n++) {
                f[ef[e][(n + ori) % 2]] = ef[j][n];
            }
        }
        const ts = "URFDLB";
        return f.map(v => ts[~~(v / 9)]).join("");
    }
    fromFacelet(facelet, customCFacelet, customEFacelet) {
        const cf = customCFacelet || cFacelet;
        const ef = customEFacelet || eFacelet;
        let count = 0;
        const fArr = [];
        const centers = facelet[4] + facelet[13] + facelet[22] + facelet[31] + facelet[40] + facelet[49];
        for (let i = 0; i < 54; ++i) {
            fArr[i] = centers.indexOf(facelet[i]);
            if (fArr[i] == -1) {
                return -1;
            }
            count += 1 << (fArr[i] << 2);
        }
        if (count != 0x999999) {
            return -1;
        }
        for (let i = 0; i < 8; ++i) {
            let ori;
            for (ori = 0; ori < 3; ++ori) {
                if (fArr[cf[i][ori]] == 0 || fArr[cf[i][ori]] == 3)
                    break;
            }
            const col1 = fArr[cf[i][(ori + 1) % 3]];
            const col2 = fArr[cf[i][(ori + 2) % 3]];
            for (let j = 0; j < 8; ++j) {
                if (col1 == ~~(cf[j][1] / 9) && col2 == ~~(cf[j][2] / 9)) {
                    this.ca[i] = j | ((ori % 3) << 3);
                    break;
                }
            }
        }
        for (let i = 0; i < 12; ++i) {
            for (let j = 0; j < 12; ++j) {
                if (fArr[ef[i][0]] == ~~(ef[j][0] / 9) && fArr[ef[i][1]] == ~~(ef[j][1] / 9)) {
                    this.ea[i] = j << 1;
                    break;
                }
                if (fArr[ef[i][0]] == ~~(ef[j][1] / 9) && fArr[ef[i][1]] == ~~(ef[j][0] / 9)) {
                    this.ea[i] = j << 1 | 1;
                    break;
                }
            }
        }
        return this;
    }
}
CubieCube.moveCube = (() => {
    const mc = [];
    for (let i = 0; i < 18; i++) {
        mc[i] = new CubieCube();
    }
    mc[0].init([3, 0, 1, 2, 4, 5, 6, 7], [6, 0, 2, 4, 8, 10, 12, 14, 16, 18, 20, 22]); // U
    mc[3].init([20, 1, 2, 8, 15, 5, 6, 19], [16, 2, 4, 6, 22, 10, 12, 14, 8, 18, 20, 0]); // R
    mc[6].init([9, 21, 2, 3, 16, 12, 6, 7], [0, 19, 4, 6, 8, 17, 12, 14, 3, 11, 20, 22]); // F
    mc[9].init([0, 1, 2, 3, 5, 6, 7, 4], [0, 2, 4, 6, 10, 12, 14, 8, 16, 18, 20, 22]); // D
    mc[12].init([0, 10, 22, 3, 4, 17, 13, 7], [0, 2, 20, 6, 8, 10, 18, 14, 16, 4, 12, 22]); // L
    mc[15].init([0, 1, 11, 23, 4, 5, 18, 14], [0, 2, 4, 23, 8, 10, 12, 21, 16, 18, 7, 15]); // B
    for (let a = 0; a < 18; a += 3) {
        for (let p = 0; p < 2; p++) {
            CubieCube.CubeMult(mc[a + p], mc[a], mc[a + p + 1]);
        }
    }
    return mc;
})();

function toUuid128(uuid) {
    if (/^[0-9A-Fa-f]{4}$/.exec(uuid)) {
        uuid = "0000" + uuid + "-0000-1000-8000-00805F9B34FB";
    }
    return uuid.toUpperCase();
}
function findCharacteristic(characteristics, uuid) {
    const targetUuid = toUuid128(uuid);
    for (const chrct of characteristics) {
        if (toUuid128(chrct.uuid) === targetUuid) {
            return chrct;
        }
    }
    return null;
}
async function waitForAdvertisements(device, timeoutMs = 5000) {
    if (typeof device.watchAdvertisements !== 'function') {
        return null;
    }
    return new Promise((resolve) => {
        const abortController = new AbortController();
        const onAdvEvent = (evt) => {
            device.removeEventListener('advertisementreceived', onAdvEvent);
            abortController.abort();
            resolve(evt.manufacturerData);
        };
        const onAbort = () => {
            device.removeEventListener('advertisementreceived', onAdvEvent);
            abortController.abort();
            resolve(null);
        };
        device.addEventListener('advertisementreceived', onAdvEvent);
        device.watchAdvertisements({ signal: abortController.signal }).catch(onAbort);
        setTimeout(onAbort, timeoutMs);
    });
}
function extractMacFromManufacturerData(mfData, cicList, reversedByteOrder = true) {
    if (!mfData)
        return null;
    let dataView;
    if (mfData instanceof DataView) {
        dataView = new DataView(mfData.buffer.slice(2));
    }
    else {
        for (const id of cicList) {
            if (mfData.has(id)) {
                dataView = mfData.get(id);
                break;
            }
        }
    }
    if (!dataView || dataView.byteLength < 6)
        return null;
    const mac = [];
    if (reversedByteOrder) {
        for (let i = 5; i >= 0; i--) {
            mac.push((dataView.getUint8(i) + 0x100).toString(16).slice(1));
        }
    }
    else {
        for (let i = dataView.byteLength - 1; i >= dataView.byteLength - 6; i--) {
            mac.push((dataView.getUint8(i) + 0x100).toString(16).slice(1));
        }
    }
    return mac.join(':');
}

const UUID_SUFFIX$4 = '-0000-1000-8000-00805f9b34fb';
const SERVICE_UUID_DATA = '0000aadb' + UUID_SUFFIX$4;
const CHRCT_UUID_DATA = '0000aadc' + UUID_SUFFIX$4;
const SERVICE_UUID_RW = '0000aaaa' + UUID_SUFFIX$4;
const CHRCT_UUID_READ$2 = '0000aaab' + UUID_SUFFIX$4;
const CHRCT_UUID_WRITE$2 = '0000aaac' + UUID_SUFFIX$4;
const GIIKER_CFACELET = [
    [26, 15, 29], [20, 8, 9], [18, 38, 6], [24, 27, 44],
    [51, 35, 17], [45, 11, 2], [47, 0, 36], [53, 42, 33]
];
const GIIKER_EFACELET = [
    [25, 28], [23, 12], [19, 7], [21, 41],
    [32, 16], [5, 10], [3, 37], [30, 43],
    [52, 34], [48, 14], [46, 1], [50, 39]
];
const DECRYPT_KEY = [176, 81, 104, 224, 86, 137, 237, 119, 38, 26, 193, 161, 210, 126, 150, 81, 93, 13, 236, 249, 89, 235, 88, 24, 113, 81, 214, 131, 130, 199, 2, 169, 39, 165, 171, 41];
const CO_MASK = [-1, 1, -1, 1, 1, -1, 1, -1];
function giikerHexPayload(value) {
    const raw = [];
    for (let i = 0; i < 20; i++) {
        raw.push(value.getUint8(i));
    }
    let logicalBytes = raw.length;
    if (raw[18] === 0xa7) {
        const k1 = (raw[19] >> 4) & 0xf;
        const k2 = raw[19] & 0xf;
        for (let i = 0; i < 18; i++) {
            raw[i] = (raw[i] + DECRYPT_KEY[i + k1] + DECRYPT_KEY[i + k2]) & 0xFF;
        }
        logicalBytes = 18;
    }
    const valhex = [];
    for (let i = 0; i < logicalBytes; i++) {
        valhex.push((raw[i] >> 4) & 0xf);
        valhex.push(raw[i] & 0xf);
    }
    return { valhex, logicalBytes };
}
function giikerMoveString(faceNibble, dirNibble) {
    const face = ["?", "B", "D", "L", "U", "R", "F"][faceNibble];
    if (!face || face === "?")
        return null;
    // Observed mappings: 1/2 => "", 3 => "2", 4 => "'", and some firmwares use 9 for half-turn.
    const dirKey = dirNibble === 9 ? 3 : dirNibble;
    const suffix = ["", "", "2", "'"][dirKey] ?? "";
    return `${face}${suffix}`;
}
function parseState(value) {
    const { valhex } = giikerHexPayload(value);
    const eo = [];
    for (let i = 0; i < 3; i++) {
        for (let mask = 8; mask !== 0; mask >>= 1) {
            eo.push((valhex[i + 28] & mask) ? 1 : 0);
        }
    }
    const cc = new CubieCube();
    for (let i = 0; i < 8; i++) {
        cc.ca[i] = (valhex[i] - 1) | (((3 + valhex[i + 8] * CO_MASK[i]) % 3) << 3);
    }
    for (let i = 0; i < 12; i++) {
        cc.ea[i] = ((valhex[i + 16] - 1) << 1) | eo[i];
    }
    const facelet = cc.toFaceCube(GIIKER_CFACELET, GIIKER_EFACELET);
    const prevMoves = [];
    // Byte 16 is the current move (face/dir nibbles). Encrypted packets must ignore bytes 18–19.
    const faceNibble = valhex[32];
    const dirNibble = valhex[33];
    if (faceNibble !== undefined && dirNibble !== undefined) {
        const mv = giikerMoveString(faceNibble, dirNibble);
        if (mv)
            prevMoves.push(mv);
    }
    return { facelet, prevMoves };
}
const GIIKER_PROTOCOL = { id: 'giiker', name: 'Giiker' };
class GiikerConnection {
    constructor(device, name) {
        this.protocol = GIIKER_PROTOCOL;
        this.capabilities = {
            gyroscope: false,
            battery: true,
            facelets: true,
            hardware: true,
            reset: true
        };
        this.gatt = null;
        this.dataChrct = null;
        this.lastFacelet = '';
        this.isReady = false;
        this.pendingValues = [];
        this.rwReadChrct = null;
        this.rwWriteChrct = null;
        this.batteryInterval = null;
        this.onBatteryChanged = null;
        this.lastBatteryLevel = null;
        this.forceNextBatteryEmission = false;
        this.onStateChanged = (event) => {
            const value = event.target.value;
            if (!value)
                return;
            if (!this.isReady) {
                // Copy the view, because the underlying buffer can be reused by the platform.
                const b = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
                this.pendingValues.push(new DataView(b));
                return;
            }
            const timestamp = now();
            const { facelet, prevMoves } = parseState(value);
            if (this.lastFacelet && this.lastFacelet !== facelet && prevMoves.length > 0) {
                const moveStr = prevMoves[0].trim();
                const face = "URFDLB".indexOf(moveStr[0]);
                const direction = moveStr.includes("2") ? 2 : moveStr.includes("'") ? 1 : 0;
                this.events$.next({
                    timestamp,
                    type: "MOVE",
                    face,
                    direction,
                    move: moveStr,
                    localTimestamp: timestamp,
                    cubeTimestamp: null
                });
            }
            this.lastFacelet = facelet;
            this.events$.next({
                timestamp,
                type: "FACELETS",
                facelets: facelet
            });
        };
        this.onDisconnect = () => {
            this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
            this.isReady = false;
            this.pendingValues = [];
            this.lastBatteryLevel = null;
            this.forceNextBatteryEmission = false;
            if (this.batteryInterval) {
                clearInterval(this.batteryInterval);
                this.batteryInterval = null;
            }
            if (this.rwReadChrct && this.onBatteryChanged) {
                this.rwReadChrct.removeEventListener('characteristicvaluechanged', this.onBatteryChanged);
            }
            this.onBatteryChanged = null;
            this.events$.next({ timestamp: now(), type: "DISCONNECT" });
            this.events$.complete();
        };
        this.device = device;
        this.deviceName = name;
        this.deviceMAC = '';
        this.events$ = new Subject();
    }
    emitHardwareEvent() {
        this.events$.next({
            timestamp: now(),
            type: "HARDWARE",
            hardwareName: this.deviceName,
            gyroSupported: false
        });
    }
    emitBatteryLevel(rawLevel, timestamp = now()) {
        if (!Number.isFinite(rawLevel)) {
            return;
        }
        const batteryLevel = Math.min(100, Math.max(0, Math.round(rawLevel)));
        const forceEmission = this.forceNextBatteryEmission;
        this.forceNextBatteryEmission = false;
        if (!forceEmission && this.lastBatteryLevel === batteryLevel) {
            return;
        }
        this.lastBatteryLevel = batteryLevel;
        this.events$.next({
            timestamp,
            type: 'BATTERY',
            batteryLevel,
        });
    }
    async init() {
        this.device.addEventListener('gattserverdisconnected', this.onDisconnect);
        this.gatt = await this.device.gatt.connect();
        const dataService = await this.gatt.getPrimaryService(SERVICE_UUID_DATA);
        this.dataChrct = await dataService.getCharacteristic(CHRCT_UUID_DATA);
        // Attach listener before notifications to reduce missed packets.
        this.dataChrct.addEventListener('characteristicvaluechanged', this.onStateChanged);
        await this.dataChrct.startNotifications();
        const initialValue = await this.dataChrct.readValue();
        const { facelet } = parseState(initialValue);
        this.lastFacelet = facelet;
        const timestamp = now();
        this.events$.next({
            timestamp,
            type: "FACELETS",
            facelets: facelet
        });
        // Setup periodic battery polling if the control service is available.
        try {
            const rwService = await this.gatt.getPrimaryService(SERVICE_UUID_RW);
            const chrcts = await rwService.getCharacteristics();
            this.rwReadChrct = findCharacteristic(chrcts, CHRCT_UUID_READ$2);
            this.rwWriteChrct = findCharacteristic(chrcts, CHRCT_UUID_WRITE$2);
            if (this.rwReadChrct && this.rwWriteChrct) {
                this.onBatteryChanged = (evt) => {
                    const val = evt.target.value;
                    if (!val)
                        return;
                    this.emitBatteryLevel(val.getUint8(1));
                };
                this.rwReadChrct.addEventListener('characteristicvaluechanged', this.onBatteryChanged);
                await this.rwReadChrct.startNotifications();
                const tick = () => {
                    if (!this.rwWriteChrct)
                        return;
                    writeGattCharacteristicValue(this.rwWriteChrct, new Uint8Array([0xb5]).buffer).catch(() => { });
                };
                tick();
                this.batteryInterval = setInterval(tick, 60000);
            }
        }
        catch {
            // Battery service may not be available
        }
        // Release any queued notifications that arrived during init.
        this.isReady = true;
        const queued = this.pendingValues;
        this.pendingValues = [];
        for (const dv of queued) {
            // Reuse the same logic path.
            const ts2 = now();
            const { facelet: f2, prevMoves: m2 } = parseState(dv);
            if (this.lastFacelet && this.lastFacelet !== f2 && m2.length > 0) {
                const moveStr = m2[0].trim();
                const face = "URFDLB".indexOf(moveStr[0]);
                const direction = moveStr.includes("2") ? 2 : moveStr.includes("'") ? 1 : 0;
                this.events$.next({
                    timestamp: ts2,
                    type: "MOVE",
                    face,
                    direction,
                    move: moveStr,
                    localTimestamp: ts2,
                    cubeTimestamp: null
                });
            }
            this.lastFacelet = f2;
            this.events$.next({
                timestamp: ts2,
                type: "FACELETS",
                facelets: f2
            });
        }
    }
    async sendCommand(command) {
        if (command.type === "REQUEST_BATTERY") {
            // Periodic battery polling is set up in init when available.
            if (this.rwWriteChrct) {
                this.forceNextBatteryEmission = true;
                await writeGattCharacteristicValue(this.rwWriteChrct, new Uint8Array([0xb5]).buffer);
            }
        }
        else if (command.type === "REQUEST_FACELETS") {
            if (this.lastFacelet) {
                this.events$.next({
                    timestamp: now(),
                    type: "FACELETS",
                    facelets: this.lastFacelet
                });
            }
        }
        else if (command.type === "REQUEST_HARDWARE") {
            this.emitHardwareEvent();
        }
        else if (command.type === "REQUEST_RESET") {
            if (this.rwWriteChrct) {
                await writeGattCharacteristicValue(this.rwWriteChrct, new Uint8Array([0xa1]).buffer);
            }
        }
    }
    async disconnect() {
        if (this.dataChrct) {
            this.dataChrct.removeEventListener('characteristicvaluechanged', this.onStateChanged);
            await this.dataChrct.stopNotifications().catch(() => { });
            this.dataChrct = null;
        }
        this.lastBatteryLevel = null;
        this.forceNextBatteryEmission = false;
        if (this.batteryInterval) {
            clearInterval(this.batteryInterval);
            this.batteryInterval = null;
        }
        if (this.rwReadChrct) {
            if (this.onBatteryChanged) {
                this.rwReadChrct.removeEventListener('characteristicvaluechanged', this.onBatteryChanged);
            }
            await this.rwReadChrct.stopNotifications().catch(() => { });
            this.rwReadChrct = null;
        }
        this.onBatteryChanged = null;
        this.rwWriteChrct = null;
        this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
        this.events$.next({ timestamp: now(), type: "DISCONNECT" });
        this.events$.complete();
        if (this.device.gatt?.connected) {
            this.device.gatt.disconnect();
        }
    }
}
const giikerProtocol = {
    nameFilters: [
        { namePrefix: "Gi" },
        { namePrefix: "Mi Smart Magic Cube" },
        { namePrefix: "Hi-" }
    ],
    optionalServices: [SERVICE_UUID_DATA, SERVICE_UUID_RW],
    matchesDevice(device) {
        const name = device.name || '';
        return name.startsWith('Gi') || name.startsWith('Mi Smart Magic Cube') || name.startsWith('Hi-');
    },
    gattAffinity(serviceUuids, _device) {
        return serviceUuids.has(normalizeUuid(SERVICE_UUID_DATA)) ? 115 : 0;
    },
    async connect(device, _macProvider, _context) {
        const devName = device.name || '';
        const name = devName.startsWith('GiC') ? 'Giiker i3' :
            devName.startsWith('GiS') ? 'Giiker i3S' :
                devName.startsWith('GiY') ? 'Giiker i3Y' :
                    devName.startsWith('Mi Smart') ? 'Mi Smart Magic Cube' :
                        devName.startsWith('Gi') ? 'Giiker i3SE' :
                            devName.startsWith('Hi-') ? 'Hi-' :
                                devName || 'Unknown';
        const conn = new GiikerConnection(device, name);
        await conn.init();
        return conn;
    }
};
registerProtocol(giikerProtocol);

const UUID_SUFFIX$3 = '-b5a3-f393-e0a9-e50e24dcca9e';
const SERVICE_UUID$3 = '6e400001' + UUID_SUFFIX$3;
const CHRCT_UUID_WRITE$1 = '6e400002' + UUID_SUFFIX$3;
const CHRCT_UUID_READ$1 = '6e400003' + UUID_SUFFIX$3;
const WRITE_BATTERY = 50;
const WRITE_STATE = 51;
const WRITE_RESET = 53;
/** Enable MsgOrientation (3D tracking). Rubik's Connected / GoCube X omit IMU; only classic GoCube uses this. */
const WRITE_ENABLE_ORIENTATION = 0x38;
const INITIAL_STATE_TIMEOUT_MS = 5000;
/** True for classic GoCube (incl. `GoCube_*`); false for Rubik's Connected and GoCube X (same UART, no gyro). */
function goCubeDeviceSupportsGyro(deviceName) {
    if (!deviceName.startsWith('GoCube')) {
        return false;
    }
    if (deviceName.startsWith('GoCubeX')) {
        return false;
    }
    return true;
}
/** Sum of bytes 0..(checksum-1) mod 256 equals checksum byte (immediately before CRLF). */
function gocubeChecksumValid(value) {
    if (value.byteLength < 7) {
        return false;
    }
    let sum = 0;
    for (let i = 0; i <= value.byteLength - 4; i++) {
        sum += value.getUint8(i);
    }
    return (sum & 0xff) === value.getUint8(value.byteLength - 3);
}
/**
 * MsgOrientation payload: ASCII decimals `x#y#z#w` (see public GoCube UART docs). Normalize to a unit quaternion.
 * Integer components are scaled together so normalization yields the physical orientation.
 *
 * Wire `(rx,ry,rz,rw)` normalized to `(nx,ny,nz,nw)` then mapped to `(nx, -nz, -ny, nw)`.
 */
function parseGoCubeOrientationPayload(payloadUtf8) {
    const parts = payloadUtf8.split('#');
    if (parts.length !== 4) {
        return null;
    }
    const rx = Number.parseInt(parts[0].trim(), 10);
    const ry = Number.parseInt(parts[1].trim(), 10);
    const rz = Number.parseInt(parts[2].trim(), 10);
    const rw = Number.parseInt(parts[3].trim(), 10);
    if (![rx, ry, rz, rw].every((n) => Number.isFinite(n))) {
        return null;
    }
    const len = Math.hypot(rx, ry, rz, rw);
    if (len === 0) {
        return null;
    }
    const nx = rx / len;
    const ny = ry / len;
    const nz = rz / len;
    const nw = rw / len;
    return { x: nx, y: -nz, z: -ny, w: nw };
}
const AXIS_PERM = [5, 2, 0, 3, 1, 4];
const FACE_PERM = [0, 1, 2, 5, 8, 7, 6, 3];
const FACE_OFFSET = [0, 0, 6, 2, 0, 0];
/** Physical opposite faces in URFDLB axis order (U↔D, R↔L, F↔B). */
const OPPOSITE_AXIS = [3, 4, 5, 0, 1, 2];
const GOCUBE_PROTOCOL = { id: 'gocube', name: 'GoCube' };
class GoCubeConnection {
    constructor(device, name, gyroSupported) {
        this.protocol = GOCUBE_PROTOCOL;
        this.readChrct = null;
        this.writeChrct = null;
        this.curCubie = new CubieCube();
        this.prevCubie = new CubieCube();
        this.moveCntFree = 100;
        this.lastBatteryLevel = null;
        this.forceNextBatteryEmission = false;
        this.batteryInterval = null;
        /** Last decoded move (axis + direction bit) for short type-1 frames that omit a full pair of bytes. */
        this.lastMoveMeta = null;
        /** First full-state (type 2) after connect: defer FACELETS until `init` finishes so subscribers never miss it. */
        this.awaitingInitialState = false;
        this.onStateChanged = (event) => {
            const value = event.target.value;
            if (!value)
                return;
            this.parseData(value);
        };
        this.pollBattery = () => {
            if (!this.writeChrct) {
                return;
            }
            writeGattCharacteristicValue(this.writeChrct, new Uint8Array([WRITE_BATTERY]).buffer).catch(() => { });
        };
        this.onDisconnect = () => {
            this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
            this.lastBatteryLevel = null;
            this.forceNextBatteryEmission = false;
            if (this.batteryInterval) {
                clearInterval(this.batteryInterval);
                this.batteryInterval = null;
            }
            this.events$.next({ timestamp: now(), type: "DISCONNECT" });
            this.events$.complete();
        };
        this.device = device;
        this.deviceName = name;
        this.deviceMAC = '';
        this.capabilities = {
            gyroscope: gyroSupported,
            battery: true,
            facelets: true,
            hardware: true,
            reset: true
        };
        this.events$ = new Subject();
    }
    applySingleMove(timestamp, axis, dirBit) {
        const power = [0, 2][dirBit];
        const m = axis * 3 + power;
        const moveStr = ("URFDLB".charAt(axis) + " 2'".charAt(power)).trim();
        CubieCube.CubeMult(this.prevCubie, CubieCube.moveCube[m], this.curCubie);
        const facelet = this.curCubie.toFaceCube();
        this.events$.next({
            timestamp,
            type: "MOVE",
            face: axis,
            direction: power === 0 ? 0 : 1,
            move: moveStr,
            localTimestamp: timestamp,
            cubeTimestamp: null
        });
        this.events$.next({
            timestamp,
            type: "FACELETS",
            facelets: facelet
        });
        const tmp = this.curCubie;
        this.curCubie = this.prevCubie;
        this.prevCubie = tmp;
        if (++this.moveCntFree > 20) {
            this.moveCntFree = 0;
            this.writeChrct &&
                writeGattCharacteristicValue(this.writeChrct, new Uint8Array([WRITE_STATE]).buffer).catch(() => { });
        }
    }
    emitBatteryLevel(rawLevel, timestamp = now()) {
        if (!Number.isFinite(rawLevel)) {
            return;
        }
        const batteryLevel = Math.min(100, Math.max(0, Math.round(rawLevel)));
        const forceEmission = this.forceNextBatteryEmission;
        this.forceNextBatteryEmission = false;
        if (!forceEmission && this.lastBatteryLevel === batteryLevel) {
            return;
        }
        this.lastBatteryLevel = batteryLevel;
        this.events$.next({
            timestamp,
            type: 'BATTERY',
            batteryLevel,
        });
    }
    parseData(value) {
        const timestamp = now();
        if (value.byteLength < 4)
            return;
        if (value.getUint8(0) !== 0x2a ||
            value.getUint8(value.byteLength - 2) !== 0x0d ||
            value.getUint8(value.byteLength - 1) !== 0x0a) {
            return;
        }
        // Full frames include a checksum byte before CRLF; short type-1 move frames may be smaller.
        if (value.byteLength >= 7 && !gocubeChecksumValid(value)) {
            return;
        }
        const msgType = value.getUint8(2);
        const msgLen = value.byteLength - 6;
        if (msgType === 3) {
            // MsgOrientation: ASCII x#y#z#w between byte 3 and checksum.
            if (!this.capabilities.gyroscope || value.byteLength < 8) {
                return;
            }
            const end = value.byteLength - 3;
            const payload = new Uint8Array(value.buffer, value.byteOffset + 3, end - 3);
            const text = new TextDecoder('utf-8', { fatal: false }).decode(payload);
            const q = parseGoCubeOrientationPayload(text);
            if (!q) {
                return;
            }
            this.events$.next({
                timestamp,
                type: 'GYRO',
                quaternion: q
            });
            return;
        }
        if (msgType === 1) { // Move
            // Firmware may send a truncated type-1 frame (< 8 bytes): treat as opposite-face turn,
            // mirroring the last full move.
            if (value.byteLength < 8) {
                if (this.lastMoveMeta) {
                    const oppAxis = OPPOSITE_AXIS[this.lastMoveMeta.axis];
                    const newDirBit = 1 - this.lastMoveMeta.dirBit;
                    this.applySingleMove(timestamp, oppAxis, newDirBit);
                    this.lastMoveMeta = { axis: oppAxis, dirBit: newDirBit };
                }
                return;
            }
            for (let i = 0; i < msgLen; i += 2) {
                const axis = AXIS_PERM[value.getUint8(3 + i) >> 1];
                const dirBit = value.getUint8(3 + i) & 1;
                this.lastMoveMeta = { axis, dirBit };
                this.applySingleMove(timestamp, axis, dirBit);
            }
        }
        else if (msgType === 2) { // Cube state
            // Full-cube state is six 9-sticker faces in wire order; unpack with AXIS_PERM/FACE_PERM.
            const facelet = [];
            for (let a = 0; a < 6; a++) {
                const axis = AXIS_PERM[a] * 9;
                const aoff = FACE_OFFSET[a];
                facelet[axis + 4] = "BFUDRL".charAt(value.getUint8(3 + a * 9));
                for (let i = 0; i < 8; i++) {
                    facelet[axis + FACE_PERM[(i + aoff) % 8]] = "BFUDRL".charAt(value.getUint8(3 + a * 9 + i + 1));
                }
            }
            const newFacelet = facelet.join('');
            const curFacelet = this.prevCubie.toFaceCube();
            if (newFacelet !== curFacelet) {
                this.curCubie.fromFacelet(newFacelet);
                const tmp = this.curCubie;
                this.curCubie = this.prevCubie;
                this.prevCubie = tmp;
            }
            if (this.awaitingInitialState && this.resolveInitialState) {
                const done = this.resolveInitialState;
                this.resolveInitialState = undefined;
                this.awaitingInitialState = false;
                done();
                return;
            }
            this.events$.next({
                timestamp,
                type: "FACELETS",
                facelets: this.prevCubie.toFaceCube()
            });
        }
        else if (msgType === 5) { // Battery
            this.emitBatteryLevel(value.getUint8(3), timestamp);
        }
    }
    emitHardwareEvent() {
        this.events$.next({
            timestamp: now(),
            type: "HARDWARE",
            hardwareName: this.deviceName,
            gyroSupported: this.capabilities.gyroscope
        });
    }
    async init() {
        this.device.addEventListener('gattserverdisconnected', this.onDisconnect);
        const gatt = await this.device.gatt.connect();
        const service = await gatt.getPrimaryService(SERVICE_UUID$3);
        this.writeChrct = await service.getCharacteristic(CHRCT_UUID_WRITE$1);
        this.readChrct = await service.getCharacteristic(CHRCT_UUID_READ$1);
        await this.readChrct.startNotifications();
        this.readChrct.addEventListener('characteristicvaluechanged', this.onStateChanged);
        if (this.capabilities.gyroscope) {
            await writeGattCharacteristicValue(this.writeChrct, new Uint8Array([WRITE_ENABLE_ORIENTATION]).buffer).catch(() => { });
        }
        const firstStatePromise = new Promise((resolve) => {
            this.resolveInitialState = resolve;
        });
        this.awaitingInitialState = true;
        await writeGattCharacteristicValue(this.writeChrct, new Uint8Array([WRITE_STATE]).buffer);
        this.pollBattery();
        this.batteryInterval = setInterval(this.pollBattery, 60000);
        await Promise.race([
            firstStatePromise,
            new Promise((resolve) => setTimeout(resolve, INITIAL_STATE_TIMEOUT_MS))
        ]);
        this.awaitingInitialState = false;
        this.resolveInitialState = undefined;
        queueMicrotask(() => {
            this.events$.next({
                timestamp: now(),
                type: "FACELETS",
                facelets: this.prevCubie.toFaceCube()
            });
        });
    }
    async sendCommand(command) {
        if (!this.writeChrct) {
            return;
        }
        if (command.type === "REQUEST_BATTERY") {
            this.forceNextBatteryEmission = true;
            await writeGattCharacteristicValue(this.writeChrct, new Uint8Array([WRITE_BATTERY]).buffer);
        }
        else if (command.type === "REQUEST_FACELETS") {
            const ts = now();
            this.events$.next({
                timestamp: ts,
                type: "FACELETS",
                facelets: this.prevCubie.toFaceCube()
            });
            await writeGattCharacteristicValue(this.writeChrct, new Uint8Array([WRITE_STATE]).buffer);
        }
        else if (command.type === "REQUEST_HARDWARE") {
            this.emitHardwareEvent();
        }
        else if (command.type === "REQUEST_RESET") {
            await writeGattCharacteristicValue(this.writeChrct, new Uint8Array([WRITE_RESET]).buffer);
            this.curCubie = new CubieCube();
            this.prevCubie = new CubieCube();
            this.lastMoveMeta = null;
            this.moveCntFree = 100;
            this.lastBatteryLevel = null;
            this.forceNextBatteryEmission = false;
            this.events$.next({
                timestamp: now(),
                type: "FACELETS",
                facelets: SOLVED_FACELET
            });
        }
    }
    async disconnect() {
        if (this.readChrct) {
            this.readChrct.removeEventListener('characteristicvaluechanged', this.onStateChanged);
            await this.readChrct.stopNotifications().catch(() => { });
            this.readChrct = null;
        }
        this.lastBatteryLevel = null;
        this.forceNextBatteryEmission = false;
        if (this.batteryInterval) {
            clearInterval(this.batteryInterval);
            this.batteryInterval = null;
        }
        this.writeChrct = null;
        this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
        this.events$.next({ timestamp: now(), type: "DISCONNECT" });
        this.events$.complete();
        if (this.device.gatt?.connected) {
            this.device.gatt.disconnect();
        }
    }
}
const goCubeProtocol = {
    nameFilters: [
        { namePrefix: 'GoCube_' },
        { namePrefix: 'GoCube' },
        { namePrefix: 'Rubiks' }
    ],
    optionalServices: [SERVICE_UUID$3],
    matchesDevice(device) {
        const name = device.name || '';
        return name.startsWith('GoCube') || name.startsWith('Rubiks');
    },
    gattAffinity(serviceUuids, _device) {
        return serviceUuids.has(normalizeUuid(SERVICE_UUID$3)) ? 110 : 0;
    },
    async connect(device, _macProvider, _context) {
        const raw = device.name ?? '';
        const name = raw.startsWith('GoCube') ? 'GoCube' : 'Rubiks Connected';
        const conn = new GoCubeConnection(device, name, goCubeDeviceSupportsGyro(raw));
        await conn.init();
        return conn;
    }
};
registerProtocol(goCubeProtocol);

/**
 * MoYu BLE API v1: fragmented request/response on 0x1001 / 0x1002 and cube-state payload parsing.
 */
const MOYU_V1_CMD_TIME = 1;
const MOYU_V1_CMD_HW = 2;
const MOYU_V1_CMD_BATTERY = 3;
const MOYU_V1_CMD_CUBE_STATE = 10;
const MOYU_V1_CMD_SLEEP = 6;
/** Sticker id 0–5 → center color letter (MoYu face order D,L,B,R,F,U). */
const STICKER_ID_TO_COLOR = 'DLBRFU';
/**
 * Map MoYu face index × cell (0–8) to URFDLB linear facelet index (U 0–8, R 9–17, …)
 */
const MOYU_CELL_TO_STD = [
    [27, 28, 29, 30, 31, 32, 33, 34, 35],
    [44, 43, 42, 41, 40, 39, 38, 37, 36],
    [53, 52, 51, 50, 49, 48, 47, 46, 45],
    [17, 16, 26, 14, 13, 12, 11, 10, 9],
    [29, 25, 24, 23, 22, 21, 20, 19, 18],
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
];
const MOYU_V1_SOLVED_STICKERS = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [2, 2, 2, 2, 2, 2, 2, 2, 2],
    [3, 3, 3, 3, 3, 3, 3, 3, 3],
    [4, 4, 4, 4, 4, 4, 4, 4, 4],
    [5, 5, 5, 5, 5, 5, 5, 5, 5],
];
function parseIncomingPart(dv) {
    const index = dv.getUint8(1) & 15;
    const total = dv.getUint8(1) >> 4;
    const payload = new Uint8Array(dv.buffer, dv.byteOffset + 2, Math.max(0, dv.byteLength - 2));
    return { index, total, payload };
}
function mergeParts(parts) {
    const sorted = [...parts].sort((a, b) => a.index - b.index);
    const len = sorted.reduce((n, p) => n + p.payload.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of sorted) {
        out.set(p.payload, o);
        o += p.payload.length;
    }
    return new DataView(out.buffer);
}
function parseResponse(merged, timestamp) {
    const header = merged.getUint8(0);
    const command = header & 15;
    const success = ((header >> 4) & 1) === 1;
    const id = (header >> 5) & 7;
    const payload = new DataView(merged.buffer, merged.byteOffset + 1, merged.byteLength - 1);
    return { command, success, id, timestamp, payload };
}
function concatU8(a, b) {
    const o = new Uint8Array(a.length + b.length);
    o.set(a);
    o.set(b, a.length);
    return o;
}
class IdGenerator {
    constructor() {
        this.lastId = 0;
    }
    next() {
        this.lastId = (this.lastId + 1) % 8;
        return this.lastId;
    }
}
class SendCountGenerator {
    constructor() {
        this.lastCount = -1;
    }
    next() {
        this.lastCount = (this.lastCount + 1) % 256;
        return this.lastCount;
    }
}
function moyuV1ParseCubeStatePayload(t) {
    const stickers = [];
    for (let s = 0; s < 6; s++) {
        const r = [];
        for (let a = 0; a < 9; a++) {
            const o = t.getUint8(Math.floor((9 * s + a) / 2));
            r.push((o >> ((9 * s + a) % 2 === 0 ? 0 : 4)) & 15);
        }
        stickers.push(r);
    }
    const angles = [];
    for (let s = 0; s < 6; s++) {
        const row = 27 + Math.floor(s / 2);
        const a = t.getUint8(row);
        angles.push((a >> (s % 2 === 0 ? 0 : 4)) & 15);
    }
    return { stickers, angles };
}
function moyuV1EncodeCubeStatePayload(stickers, angles) {
    const e = new Uint8Array(30);
    const i = new DataView(e.buffer);
    for (let s = 0; s < 6; s++) {
        for (let r = 0; r < 9; r++) {
            const lo = (9 * s + r) % 2 === 0;
            const o = Math.floor((9 * s + r) / 2);
            i.setUint8(o, i.getUint8(o) | ((15 & stickers[s][r]) << (lo ? 0 : 4)));
        }
    }
    for (let s = 0; s < 6; s++) {
        const lo = s % 2 === 0;
        const row = 27 + Math.floor(s / 2);
        i.setUint8(row, i.getUint8(row) | ((15 & angles[s]) << (lo ? 0 : 4)));
    }
    return e;
}
/** Build 54-char URFDLB facelet string for CubieCube.fromFacelet. */
function moyuStickersToFaceletString(stickers) {
    const chars = new Array(54).fill('?');
    for (let face = 0; face < 6; face++) {
        const row = MOYU_CELL_TO_STD[face];
        const stickerRow = stickers[face];
        for (let p = 0; p < 9; p++) {
            const id = stickerRow[p] & 15;
            const c = id < 6 ? STICKER_ID_TO_COLOR[id] : '?';
            chars[row[p]] = c;
        }
    }
    return chars.join('');
}
class MoyuV1Client {
    constructor(writeCharacteristic) {
        this.writeCharacteristic = writeCharacteristic;
        this.idGen = new IdGenerator();
        this.sendCountGen = new SendCountGenerator();
        this.incomplete = [];
        this.waiters = [];
    }
    /** Call from 0x1002 notification handler. */
    onReadNotification(dv) {
        const part = parseIncomingPart(dv);
        this.incomplete.push(part);
        if (part.total <= 0 || part.index !== part.total - 1) {
            return;
        }
        const merged = mergeParts(this.incomplete);
        this.incomplete = [];
        const receivedAt = Date.now();
        const r = parseResponse(merged, receivedAt);
        const idx = this.waiters.findIndex((w) => w.command === r.command && w.id === r.id);
        if (idx < 0) {
            return;
        }
        const w = this.waiters.splice(idx, 1)[0];
        clearTimeout(w.timeout);
        if (!r.success) {
            w.reject(new Error(`MoYu v1 command ${r.command} failed`));
            return;
        }
        w.resolve({ sentAt: w.sentAt, receivedAt, value: r.payload });
    }
    headerByte(command, hasPayload, id) {
        return command | ((hasPayload ? 1 : 0) << 4) | (id << 5);
    }
    async sendRawRequest(body) {
        const nParts = Math.ceil(body.length / 18);
        if (nParts > 16)
            throw new Error('Too many parts');
        for (let i = 0; i < nParts; i++) {
            const frame = new Uint8Array(20);
            const v = new DataView(frame.buffer);
            v.setUint8(0, this.sendCountGen.next());
            v.setUint8(1, i | (nParts << 4));
            const slice = body.subarray(18 * i, 18 * (i + 1));
            frame.set(slice, 2);
            await writeGattCharacteristicValue(this.writeCharacteristic, frame);
        }
        return Date.now();
    }
    async send(command, payload) {
        const id = this.idGen.next();
        const hasPayload = payload !== undefined;
        const h = this.headerByte(command, hasPayload, id);
        const first = new Uint8Array(1);
        new DataView(first.buffer).setUint8(0, h);
        const body = hasPayload && payload !== undefined ? concatU8(first, payload) : first;
        let waiter;
        const result = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const i = this.waiters.findIndex((w) => w.command === command && w.id === id);
                if (i >= 0)
                    this.waiters.splice(i, 1);
                reject(new Error(`MoYu v1 command ${command} timeout`));
            }, 5000);
            waiter = { command, id, sentAt: 0, resolve, reject, timeout };
            this.waiters.push(waiter);
        });
        waiter.sentAt = await this.sendRawRequest(body);
        return result;
    }
    async getCubeState() {
        const r = await this.send(MOYU_V1_CMD_CUBE_STATE);
        return moyuV1ParseCubeStatePayload(r.value);
    }
    async setCubeState(stickers = MOYU_V1_SOLVED_STICKERS, angles = [0, 0, 0, 0, 0, 0]) {
        const pl = moyuV1EncodeCubeStatePayload(stickers, angles);
        await this.send(MOYU_V1_CMD_CUBE_STATE, pl);
    }
    async getBatteryInfo() {
        const r = await this.send(MOYU_V1_CMD_BATTERY);
        const t = r.value;
        return {
            sentAt: r.sentAt,
            receivedAt: r.receivedAt,
            value: {
                charging: !!t.getUint8(0),
                full: !!t.getUint8(1),
                percentage: t.getUint16(2, true),
                voltage: t.getInt32(4, true) / 1000,
            },
        };
    }
    async getHardwareInfo() {
        const r = await this.send(MOYU_V1_CMD_HW);
        const t = r.value;
        return {
            bootCount: t.getUint32(16, true),
            major: t.getUint8(20),
            minor: t.getUint8(21),
            patch: t.getUint16(22, true),
        };
    }
    async getTime() {
        const r = await this.send(MOYU_V1_CMD_TIME);
        const v = r.value;
        return {
            sentAt: r.sentAt,
            receivedAt: r.receivedAt,
            value: { seconds: v.getUint16(0, true), counter: v.getUint16(2, true) },
        };
    }
    async setSleepState(state) {
        const e = new Uint8Array(1);
        new DataView(e.buffer).setUint8(0, state);
        await this.send(MOYU_V1_CMD_SLEEP, e);
    }
}

const UUID_SUFFIX$2 = '-0000-1000-8000-00805f9b34fb';
const SERVICE_UUID$2 = '00001000' + UUID_SUFFIX$2;
const CHRCT_UUID_WRITE = '00001001' + UUID_SUFFIX$2;
const CHRCT_UUID_READ = '00001002' + UUID_SUFFIX$2;
const CHRCT_UUID_TURN = '00001003' + UUID_SUFFIX$2;
const CHRCT_UUID_GYRO = '00001004' + UUID_SUFFIX$2;
const FACE_ORDER_LEN = 6;
const DEVICE_FACE_TO_AXIS = [3, 4, 5, 1, 2, 0];
function normalizeQuaternion(q) {
    const n = Math.hypot(q.w, q.x, q.y, q.z) || 1;
    return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}
const MOYU_MHC_PROTOCOL = { id: 'moyu-mhc', name: 'MoYu MHC' };
class MoyuMhcConnection {
    constructor(device) {
        this.protocol = MOYU_MHC_PROTOCOL;
        this.writeChrct = null;
        this.readChrct = null;
        this.turnChrct = null;
        this.gyroChrct = null;
        this.v1 = null;
        this.faceStatus = [0, 0, 0, 0, 0, 0];
        this.curCubie = new CubieCube();
        this.prevCubie = new CubieCube();
        this.lastBatteryLevel = null;
        this.batteryInterval = null;
        this.onTurnEvent = (event) => {
            const value = event.target.value;
            if (!value)
                return;
            this.parseTurn(value);
        };
        this.onReadEvent = (event) => {
            const value = event.target.value;
            if (!value || !this.v1)
                return;
            this.v1.onReadNotification(value);
        };
        this.onGyroEvent = (event) => {
            const e = event.target.value;
            if (!e || e.byteLength < 20)
                return;
            const fw = e.getFloat32(4, true);
            const fx = e.getFloat32(8, true);
            const fy = e.getFloat32(12, true);
            const fz = e.getFloat32(16, true);
            const quaternion = normalizeQuaternion({
                w: fw,
                x: fx,
                y: -fy,
                z: fz,
            });
            const timestamp = now();
            this.events$.next({
                timestamp,
                type: 'GYRO',
                quaternion,
            });
        };
        this.onDisconnect = () => {
            this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
            this.lastBatteryLevel = null;
            if (this.batteryInterval) {
                clearInterval(this.batteryInterval);
                this.batteryInterval = null;
            }
            this.events$.next({ timestamp: now(), type: "DISCONNECT" });
            this.events$.complete();
        };
        this.device = device;
        this.deviceName = device.name || 'MHC';
        this.deviceMAC = '';
        this.events$ = new Subject();
        this.capabilities = {
            gyroscope: false,
            battery: false,
            facelets: false,
            hardware: false,
            reset: false,
        };
    }
    /**
     * After each move, `prevCubie` holds the latest physical state (see parseTurn swap).
     * Seed that cube from the device facelet string and align turn counters with gyro angles.
     */
    applyCubeStateFromDevice(stickers, angles) {
        const facelet = moyuStickersToFaceletString(stickers);
        this.prevCubie = new CubieCube();
        const parsed = this.prevCubie.fromFacelet(facelet);
        if (parsed === -1) {
            this.prevCubie = new CubieCube();
            this.curCubie = new CubieCube();
            this.faceStatus = [0, 0, 0, 0, 0, 0];
            return;
        }
        this.curCubie = new CubieCube();
        for (let i = 0; i < FACE_ORDER_LEN; i++) {
            this.faceStatus[i] = (angles[i] ?? 0) % 9;
        }
    }
    parseTurn(data) {
        const timestamp = now();
        if (data.byteLength < 1)
            return;
        const nMoves = data.getUint8(0);
        if (data.byteLength < 1 + nMoves * 6)
            return;
        for (let i = 0; i < nMoves; i++) {
            const offset = 1 + i * 6;
            let ts = data.getUint8(offset + 1) << 24
                | data.getUint8(offset + 0) << 16
                | data.getUint8(offset + 3) << 8
                | data.getUint8(offset + 2);
            ts = Math.round(ts / 65536 * 1000);
            const face = data.getUint8(offset + 4);
            if (face >= FACE_ORDER_LEN)
                continue;
            const dir = Math.round(data.getInt8(offset + 5) / 36);
            const prevRot = this.faceStatus[face];
            const curRot = this.faceStatus[face] + dir;
            this.faceStatus[face] = (curRot + 9) % 9;
            const axis = DEVICE_FACE_TO_AXIS[face];
            let pow;
            if (prevRot >= 5 && curRot <= 4) {
                pow = 2;
            }
            else if (prevRot <= 4 && curRot >= 5) {
                pow = 0;
            }
            else {
                continue;
            }
            const m = axis * 3 + pow;
            const moveStr = ("URFDLB".charAt(axis) + " 2'".charAt(pow)).trim();
            CubieCube.CubeMult(this.prevCubie, CubieCube.moveCube[m], this.curCubie);
            const faceletStr = this.curCubie.toFaceCube();
            this.events$.next({
                timestamp,
                type: "MOVE",
                face: axis,
                direction: pow === 0 ? 0 : 1,
                move: moveStr,
                localTimestamp: timestamp,
                cubeTimestamp: ts
            });
            this.events$.next({
                timestamp,
                type: "FACELETS",
                facelets: faceletStr
            });
            const tmp = this.curCubie;
            this.curCubie = this.prevCubie;
            this.prevCubie = tmp;
        }
    }
    emitBatteryLevel(rawLevel, timestamp = now(), forceEmission = false) {
        if (!Number.isFinite(rawLevel)) {
            return;
        }
        const batteryLevel = Math.min(100, Math.max(0, Math.round(rawLevel)));
        if (!forceEmission && this.lastBatteryLevel === batteryLevel) {
            return;
        }
        this.lastBatteryLevel = batteryLevel;
        this.events$.next({
            timestamp,
            type: 'BATTERY',
            batteryLevel,
        });
    }
    async pollBattery() {
        if (!this.v1) {
            return;
        }
        try {
            const b = await this.v1.getBatteryInfo();
            this.emitBatteryLevel(b.value.percentage);
        }
        catch {
            /* ignore failed optional commands */
        }
    }
    updateCapabilities() {
        const hasV1 = this.v1 !== null;
        this.capabilities.gyroscope = this.gyroChrct !== null;
        this.capabilities.battery = hasV1;
        this.capabilities.facelets = hasV1;
        this.capabilities.hardware = hasV1;
        this.capabilities.reset = hasV1;
    }
    async init() {
        this.device.addEventListener('gattserverdisconnected', this.onDisconnect);
        const gatt = await this.device.gatt.connect();
        const service = await gatt.getPrimaryService(SERVICE_UUID$2);
        const chrcts = await service.getCharacteristics();
        this.writeChrct = findCharacteristic(chrcts, CHRCT_UUID_WRITE);
        this.readChrct = findCharacteristic(chrcts, CHRCT_UUID_READ);
        this.turnChrct = findCharacteristic(chrcts, CHRCT_UUID_TURN);
        this.gyroChrct = findCharacteristic(chrcts, CHRCT_UUID_GYRO);
        if (this.writeChrct) {
            this.v1 = new MoyuV1Client(this.writeChrct);
        }
        if (this.readChrct) {
            this.readChrct.addEventListener('characteristicvaluechanged', this.onReadEvent);
            await this.readChrct.startNotifications();
        }
        if (this.turnChrct) {
            this.turnChrct.addEventListener('characteristicvaluechanged', this.onTurnEvent);
            await this.turnChrct.startNotifications();
        }
        if (this.gyroChrct) {
            this.gyroChrct.addEventListener('characteristicvaluechanged', this.onGyroEvent);
            await this.gyroChrct.startNotifications();
        }
        this.updateCapabilities();
        if (this.v1) {
            await this.pollBattery();
            this.batteryInterval = setInterval(() => {
                void this.pollBattery();
            }, 60000);
            try {
                const st = await this.v1.getCubeState();
                this.applyCubeStateFromDevice(st.stickers, st.angles);
                const facelets = this.prevCubie.toFaceCube();
                this.events$.next({
                    timestamp: now(),
                    type: 'FACELETS',
                    facelets,
                });
            }
            catch {
                this.events$.next({
                    timestamp: now(),
                    type: 'FACELETS',
                    facelets: SOLVED_FACELET,
                });
            }
        }
        else {
            this.events$.next({
                timestamp: now(),
                type: 'FACELETS',
                facelets: SOLVED_FACELET,
            });
        }
    }
    async sendCommand(command) {
        if (!this.v1)
            return;
        const ts = now();
        try {
            if (command.type === 'REQUEST_FACELETS') {
                const st = await this.v1.getCubeState();
                this.applyCubeStateFromDevice(st.stickers, st.angles);
                this.events$.next({
                    timestamp: ts,
                    type: 'FACELETS',
                    facelets: this.prevCubie.toFaceCube(),
                });
            }
            else if (command.type === 'REQUEST_BATTERY') {
                const b = await this.v1.getBatteryInfo();
                this.emitBatteryLevel(b.value.percentage, ts, true);
            }
            else if (command.type === 'REQUEST_HARDWARE') {
                const h = await this.v1.getHardwareInfo();
                this.events$.next({
                    timestamp: ts,
                    type: 'HARDWARE',
                    softwareVersion: `${h.major}.${h.minor}.${h.patch}`,
                    hardwareVersion: `boot:${h.bootCount}`,
                    gyroSupported: this.capabilities.gyroscope,
                });
            }
            else if (command.type === 'REQUEST_RESET') {
                await this.v1.setCubeState(MOYU_V1_SOLVED_STICKERS, [0, 0, 0, 0, 0, 0]);
                this.faceStatus = [0, 0, 0, 0, 0, 0];
                this.curCubie = new CubieCube();
                this.prevCubie = new CubieCube();
                this.events$.next({
                    timestamp: ts,
                    type: 'FACELETS',
                    facelets: SOLVED_FACELET,
                });
            }
        }
        catch {
            /* ignore failed optional commands */
        }
    }
    async disconnect() {
        if (this.readChrct) {
            this.readChrct.removeEventListener('characteristicvaluechanged', this.onReadEvent);
            await this.readChrct.stopNotifications().catch(() => { });
        }
        if (this.turnChrct) {
            this.turnChrct.removeEventListener('characteristicvaluechanged', this.onTurnEvent);
            await this.turnChrct.stopNotifications().catch(() => { });
        }
        if (this.gyroChrct) {
            this.gyroChrct.removeEventListener('characteristicvaluechanged', this.onGyroEvent);
            await this.gyroChrct.stopNotifications().catch(() => { });
        }
        this.lastBatteryLevel = null;
        if (this.batteryInterval) {
            clearInterval(this.batteryInterval);
            this.batteryInterval = null;
        }
        this.readChrct = null;
        this.turnChrct = null;
        this.gyroChrct = null;
        this.writeChrct = null;
        this.v1 = null;
        this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
        this.events$.next({ timestamp: now(), type: "DISCONNECT" });
        this.events$.complete();
        if (this.device.gatt?.connected) {
            this.device.gatt.disconnect();
        }
    }
}
const moyuMhcProtocol = {
    nameFilters: [
        { namePrefix: "MHC" }
    ],
    optionalServices: [SERVICE_UUID$2],
    matchesDevice(device) {
        const name = device.name || '';
        return name.startsWith('MHC');
    },
    gattAffinity(serviceUuids, _device) {
        return serviceUuids.has(normalizeUuid(SERVICE_UUID$2)) ? 110 : 0;
    },
    async connect(device, _macProvider, _context) {
        const conn = new MoyuMhcConnection(device);
        await conn.init();
        return conn;
    }
};
registerProtocol(moyuMhcProtocol);

/**
 * Derive BLE address candidates from advertised device names (pattern-based only).
 */
function pushUnique(out, seen, mac) {
    if (seen.has(mac)) {
        return;
    }
    seen.add(mac);
    out.push(mac);
}
/**
 * QiYi / XMD-style names: build candidate MACs for cryptographic probing.
 */
function buildQiYiMacCandidatesFromName(deviceName) {
    const out = [];
    const seen = new Set();
    if (!deviceName) {
        return out;
    }
    const t = deviceName.trim();
    const qyA = /^QY-QYSC-A-([0-9A-Fa-f]{4})$/.exec(t);
    if (qyA) {
        const x = qyA[1].toUpperCase();
        pushUnique(out, seen, `CC:A2:00:00:${x.slice(0, 2)}:${x.slice(2, 4)}`);
    }
    const qyS = /^QY-QYSC-S-([0-9A-Fa-f]{4})$/.exec(t);
    if (qyS) {
        const x = qyS[1].toUpperCase();
        const a = `${x.slice(0, 2)}:${x.slice(2, 4)}`;
        pushUnique(out, seen, `CC:A3:00:00:${a}`);
        pushUnique(out, seen, `CC:A3:00:01:${a}`);
    }
    const xmd = /^XMD-TornadoV4-i-([0-9A-Fa-f]{4})$/.exec(t);
    if (xmd) {
        const x = xmd[1].toUpperCase();
        pushUnique(out, seen, `CC:A6:00:00:${x.slice(0, 2)}:${x.slice(2, 4)}`);
    }
    return out.slice(0, 100);
}
/**
 * MoYu32 / WCU name patterns: multiple third-byte variants per hardware line.
 */
function buildMoyu32MacCandidatesFromName(deviceName) {
    const out = [];
    const seen = new Set();
    if (!deviceName) {
        return out;
    }
    const t = deviceName.trim();
    const my32 = /^WCU_MY32_([0-9A-Fa-f]{4})$/.exec(t);
    if (my32) {
        const x = my32[1].toUpperCase();
        const a = `${x.slice(0, 2)}:${x.slice(2, 4)}`;
        for (const mid of ['00', '01', '02']) {
            pushUnique(out, seen, `CF:30:16:${mid}:${a}`);
        }
    }
    const my33 = /^WCU_MY33_([0-9A-Fa-f]{4})$/.exec(t);
    if (my33) {
        const x = my33[1].toUpperCase();
        const a = `${x.slice(0, 2)}:${x.slice(2, 4)}`;
        for (const mid of ['02', '01', '00']) {
            pushUnique(out, seen, `CF:30:16:${mid}:${a}`);
        }
    }
    return out.slice(0, 100);
}

const BASE_KEY$1 = [21, 119, 58, 92, 103, 14, 45, 31, 23, 103, 42, 19, 155, 103, 82, 87];
const BASE_IV$1 = [17, 35, 38, 37, 134, 42, 44, 59, 85, 6, 127, 49, 126, 103, 33, 87];
function macSegments(mac) {
    const parts = mac.split(/[:-\s]+/).map((x) => parseInt(x, 16));
    if (parts.length < 6 || parts.some((n) => Number.isNaN(n))) {
        throw new Error('Invalid MAC');
    }
    return parts.slice(0, 6);
}
/** MoYu32 AES session crypto keyed by device address (same derivation as protocol driver). */
function createMoyu32SessionCrypto(mac) {
    const t = macSegments(mac);
    const key = BASE_KEY$1.slice();
    const iv = BASE_IV$1.slice();
    for (let i = 0; i < 6; i++) {
        key[i] = (key[i] + t[5 - i]) % 255;
        iv[i] = (iv[i] + t[5 - i]) % 255;
    }
    return {
        decrypt(raw) {
            const cipher = new ModeOfOperation.ecb(new Uint8Array(key));
            const ret = raw.slice();
            if (ret.length > 16) {
                const offset = ret.length - 16;
                const block = cipher.decrypt(new Uint8Array(ret.slice(offset)));
                for (let i = 0; i < 16; i++) {
                    ret[i + offset] = block[i] ^ iv[i];
                }
            }
            const block = cipher.decrypt(new Uint8Array(ret.slice(0, 16)));
            for (let i = 0; i < 16; i++) {
                ret[i] = block[i] ^ iv[i];
            }
            return ret;
        },
        encrypt(data) {
            const ret = data.slice();
            const cipher = new ModeOfOperation.ecb(new Uint8Array(key));
            for (let i = 0; i < 16; i++) {
                ret[i] ^= iv[i];
            }
            const block = cipher.encrypt(new Uint8Array(ret.slice(0, 16)));
            for (let i = 0; i < 16; i++) {
                ret[i] = block[i];
            }
            if (ret.length > 16) {
                const offset = ret.length - 16;
                for (let i = 0; i < 16; i++) {
                    ret[i + offset] ^= iv[i];
                }
                const block2 = cipher.encrypt(new Uint8Array(ret.slice(offset, offset + 16)));
                for (let i = 0; i < 16; i++) {
                    ret[i + offset] = block2[i];
                }
            }
            return ret;
        },
    };
}

/**
 * Post-decrypt sanity checks for MAC candidate probing.
 */
/** Validates decrypted MoYu32 notification bitstream. */
function isValidMoYu32DecryptedPacket(bytes) {
    if (!bytes || bytes.length < 20) {
        return false;
    }
    try {
        for (let i = 0; i < bytes.length; i++) {
            if (bytes[i] < 0 || bytes[i] > 255) {
                return false;
            }
        }
        let z = 0;
        let f = 0;
        for (let n = 0; n < Math.min(bytes.length, 20); n++) {
            if (bytes[n] === 0) {
                z++;
            }
            else if (bytes[n] === 255) {
                f++;
            }
        }
        if (z > 14 || f > 14 || new Set(bytes.slice(0, 20)).size > 18) {
            return false;
        }
        let n = '';
        for (let i = 0; i < bytes.length; i++) {
            n += (bytes[i] + 256).toString(2).slice(1);
        }
        const r = parseInt(n.slice(0, 8), 2);
        return validateMoYu32BitBody(n, r);
    }
    catch {
        return false;
    }
}
function validateMoYu32BitBody(e, t) {
    if (!e || e.length < 160) {
        return false;
    }
    try {
        const i = parseInt(e.slice(0, 8), 2);
        if (i !== t ||
            ![161, 163, 164, 165, 171].includes(i) ||
            (i === 164 && parseInt(e.slice(8, 16), 2) > 100)) {
            return false;
        }
        if (i === 161) {
            for (let k = 0; k < 8; k++) {
                const v = parseInt(e.slice(8 + 8 * k, 16 + 8 * k), 2);
                if (v !== 0 && (v < 32 || v > 126)) {
                    return false;
                }
            }
        }
        if (i === 165) {
            let c = 0;
            for (let j = 0; j < 5; j++) {
                const v = parseInt(e.slice(96 + 5 * j, 101 + 5 * j), 2);
                if (v <= 11) {
                    c++;
                }
                else if (v < 31) {
                    return false;
                }
            }
            if (c === 0) {
                return false;
            }
            let allZero = true;
            let allMax = true;
            for (let r = 0; r < c; r++) {
                const v = parseInt(e.slice(8 + 16 * r, 24 + 16 * r), 2);
                if (v !== 0) {
                    allZero = false;
                }
                if (v !== 65535) {
                    allMax = false;
                }
            }
            if (allZero || allMax) {
                return false;
            }
        }
        if (i === 163) {
            const body = e.slice(8, 152);
            const zeros = (body.match(/0/g) || []).length;
            const ones = (body.match(/1/g) || []).length;
            if (zeros > 0.9 * body.length || ones > 0.9 * body.length) {
                return false;
            }
        }
        return true;
    }
    catch {
        return false;
    }
}
/** Validates decrypted QiYi notification payload. */
function isValidQiYiDecryptedPacket(e) {
    if (!e || e.length < 7) {
        return false;
    }
    try {
        const t = e[0];
        if (t === 254) {
            const cmd = e[1];
            const sub = e[2];
            if (![2, 3].includes(sub) || cmd < 7 || cmd > 100) {
                return false;
            }
            const n = (((e[3] << 24) | (e[4] << 16) | (e[5] << 8) | e[6]) >>> 0);
            if (n === 0 || n === 0xffffffff) {
                return false;
            }
            return true;
        }
        if (t === 204 && e[1] === 16) {
            if (e.length < 16) {
                return false;
            }
            const dv = new DataView(e.buffer, e.byteOffset);
            const x = dv.getInt16(6, false);
            const y = dv.getInt16(8, false);
            const z = dv.getInt16(10, false);
            const w = dv.getInt16(12, false);
            if (Math.abs(x) > 2000 ||
                Math.abs(y) > 2000 ||
                Math.abs(z) > 2000 ||
                Math.abs(w) > 2000) {
                return false;
            }
            return true;
        }
        return false;
    }
    catch {
        return false;
    }
}

const MOYU32_SVC = '0783b03e-7735-b5a0-1760-a305d2795cb0';
const MOYU32_CHR_READ = '0783b03e-7735-b5a0-1760-a305d2795cb1';
const MOYU32_CHR_WRITE = '0783b03e-7735-b5a0-1760-a305d2795cb2';
/**
 * Returns true if notifications decrypt to plausible MoYu32 payloads for this MAC.
 */
async function probeMoyu32Mac(device, mac, options) {
    const timeoutMs = options?.timeoutMs;
    const gatt = device.gatt;
    if (!gatt) {
        return false;
    }
    if (!gatt.connected) {
        await gatt.connect();
    }
    const service = await gatt.getPrimaryService(MOYU32_SVC);
    const chrcts = await service.getCharacteristics();
    const readChrct = findCharacteristic(chrcts, MOYU32_CHR_READ);
    const writeChrct = findCharacteristic(chrcts, MOYU32_CHR_WRITE);
    if (!readChrct || !writeChrct) {
        return false;
    }
    const crypto = createMoyu32SessionCrypto(mac);
    let samples = 0;
    let good = 0;
    let stopped = false;
    const onNotify = (ev) => {
        if (stopped) {
            return;
        }
        const t = ev.target.value;
        if (!t) {
            return;
        }
        try {
            const raw = [];
            for (let i = 0; i < t.byteLength; i++) {
                raw.push(t.getUint8(i));
            }
            const dec = crypto.decrypt(raw);
            samples++;
            if (isValidMoYu32DecryptedPacket(dec)) {
                good++;
            }
        }
        catch {
            samples++;
        }
    };
    readChrct.addEventListener('characteristicvaluechanged', onNotify);
    await readChrct.startNotifications();
    const sendCmd = async (cmd) => {
        const t = Array(20).fill(0);
        t[0] = cmd;
        const enc = crypto.encrypt(t);
        await writeGattCharacteristicValue(writeChrct, new Uint8Array(enc).buffer);
    };
    const sendInitBurst = async () => {
        await sendCmd(161);
        await sendCmd(163);
        await sendCmd(164);
    };
    try {
        await sendInitBurst();
        // Some MoYu32 variants do not begin steady-state status updates until
        // they receive the same startup request burst a second time.
        await sendInitBurst();
    }
    catch {
        stopped = true;
        readChrct.removeEventListener('characteristicvaluechanged', onNotify);
        await readChrct.stopNotifications().catch(() => { });
        return false;
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !stopped) {
        if (options?.signal?.aborted) {
            stopped = true;
            break;
        }
        if (good >= 3) {
            stopped = true;
            break;
        }
        if (samples > 8 && good === 0) {
            break;
        }
        await new Promise((r) => setTimeout(r, 120));
    }
    stopped = true;
    readChrct.removeEventListener('characteristicvaluechanged', onNotify);
    await readChrct.stopNotifications().catch(() => { });
    return good >= 3;
}

const SERVICE_UUID$1 = '0783b03e-7735-b5a0-1760-a305d2795cb0';
const CHRT_UUID_READ = '0783b03e-7735-b5a0-1760-a305d2795cb1';
const CHRT_UUID_WRITE = '0783b03e-7735-b5a0-1760-a305d2795cb2';
/** Opcode 172 + payload to enable gyro notifications (MoYu WCU). */
const ENABLE_GYRO_PAYLOAD = Object.freeze([
    172, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);
const BASE_KEY = [21, 119, 58, 92, 103, 14, 45, 31, 23, 103, 42, 19, 155, 103, 82, 87];
const BASE_IV = [17, 35, 38, 37, 134, 42, 44, 59, 85, 6, 127, 49, 126, 103, 33, 87];
/**
 * Parse 6 MAC octets from a manufacturer data DataView into canonical `aa:bb:…` form.
 * When length >= 8, the first two bytes are treated as company ID and skipped; the next six
 * are the cube address in LSB-first wire order (reversed into display order), matching key derivation.
 */
function moyu32MacColonFromManufacturerDataView(dv) {
    const n = dv.byteLength;
    if (n < 6) {
        return null;
    }
    const skipCid = n >= 8 ? 2 : 0;
    if (n < skipCid + 6) {
        return null;
    }
    const parts = [];
    for (let i = 0; i < 6; i++) {
        parts.push((dv.getUint8(skipCid + 5 - i) + 0x100).toString(16).slice(1));
    }
    return parts.join(':');
}
function parseMoyu32MacFromMf(mfData) {
    if (!mfData) {
        return null;
    }
    if (mfData instanceof DataView) {
        return moyu32MacColonFromManufacturerDataView(mfData);
    }
    for (const id of mfData.keys()) {
        const dataView = mfData.get(id);
        if (dataView) {
            const mac = moyu32MacColonFromManufacturerDataView(dataView);
            if (mac) {
                return mac;
            }
        }
    }
    return null;
}
class Moyu32Encrypter {
    constructor(macBytes) {
        this.key = BASE_KEY.slice();
        this.iv = BASE_IV.slice();
        for (let i = 0; i < 6; i++) {
            this.key[i] = (this.key[i] + macBytes[5 - i]) % 255;
            this.iv[i] = (this.iv[i] + macBytes[5 - i]) % 255;
        }
    }
    decrypt(data) {
        const ret = data.slice();
        const cipher = new ModeOfOperation.ecb(new Uint8Array(this.key));
        if (ret.length > 16) {
            const offset = ret.length - 16;
            const block = cipher.decrypt(new Uint8Array(ret.slice(offset)));
            for (let i = 0; i < 16; i++) {
                ret[i + offset] = block[i] ^ (~~this.iv[i]);
            }
        }
        const block = cipher.decrypt(new Uint8Array(ret.slice(0, 16)));
        for (let i = 0; i < 16; i++) {
            ret[i] = block[i] ^ (~~this.iv[i]);
        }
        return ret;
    }
    encrypt(data) {
        const ret = data.slice();
        const cipher = new ModeOfOperation.ecb(new Uint8Array(this.key));
        for (let i = 0; i < 16; i++) {
            ret[i] ^= ~~this.iv[i];
        }
        const block = cipher.encrypt(new Uint8Array(ret.slice(0, 16)));
        for (let i = 0; i < 16; i++) {
            ret[i] = block[i];
        }
        if (ret.length > 16) {
            const offset = ret.length - 16;
            for (let i = 0; i < 16; i++) {
                ret[i + offset] ^= ~~this.iv[i];
            }
            const block2 = cipher.encrypt(new Uint8Array(ret.slice(offset, offset + 16)));
            for (let i = 0; i < 16; i++) {
                ret[i + offset] = block2[i];
            }
        }
        return ret;
    }
}
function parseFacelet$1(faceletBits) {
    const state = [];
    const faces = [2, 5, 0, 3, 4, 1]; // parse in order URFDLB instead of FBUDLR
    for (let i = 0; i < 6; i++) {
        const face = faceletBits.slice(faces[i] * 24, 24 + faces[i] * 24);
        for (let j = 0; j < 8; j++) {
            state.push("FBUDLR".charAt(parseInt(face.slice(j * 3, 3 + j * 3), 2)));
            if (j === 3) {
                state.push("FBUDLR".charAt(faces[i]));
            }
        }
    }
    return state.join('');
}
const MOYU32_PROTOCOL = { id: 'moyu32', name: 'MoYu32' };
class Moyu32Connection {
    constructor(device, mac) {
        this.protocol = MOYU32_PROTOCOL;
        this.capabilities = {
            gyroscope: false,
            battery: true,
            facelets: true,
            hardware: true,
            reset: false
        };
        this.readChrct = null;
        this.writeChrct = null;
        this.encrypter = null;
        this.prevCubie = new CubieCube();
        this.curCubie = new CubieCube();
        this.latestFacelet = SOLVED_FACELET;
        this.deviceTime = 0;
        this.deviceTimeOffset = 0;
        this.moveCnt = -1;
        this.prevMoveCnt = -1;
        this.lastBatteryLevel = null;
        this.forceNextBatteryEmission = false;
        this.batteryInterval = null;
        this.onStateChanged = (event) => {
            const value = event.target.value;
            if (!value || !this.encrypter)
                return;
            this.parseData(value);
        };
        this.pollBattery = () => {
            void this.sendSimpleRequest(164);
        };
        this.onDisconnect = () => {
            this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
            this.lastBatteryLevel = null;
            this.forceNextBatteryEmission = false;
            if (this.batteryInterval) {
                clearInterval(this.batteryInterval);
                this.batteryInterval = null;
            }
            this.events$.next({ timestamp: now(), type: "DISCONNECT" });
            this.events$.complete();
        };
        this.device = device;
        this.deviceName = device.name || 'WCU_MY3';
        this.deviceMAC = mac;
        this.events$ = new Subject();
    }
    sendRequest(req) {
        if (!this.writeChrct)
            return Promise.resolve();
        const encoded = this.encrypter ? this.encrypter.encrypt(req.slice()) : req;
        return writeGattCharacteristicValue(this.writeChrct, new Uint8Array(encoded).buffer).then(() => { });
    }
    sendSimpleRequest(opcode) {
        const req = new Array(20).fill(0);
        req[0] = opcode;
        return this.sendRequest(req);
    }
    emitBatteryLevel(rawLevel, timestamp = now()) {
        if (!Number.isFinite(rawLevel)) {
            return;
        }
        const batteryLevel = Math.min(100, Math.max(0, Math.round(rawLevel)));
        const forceEmission = this.forceNextBatteryEmission;
        this.forceNextBatteryEmission = false;
        if (!forceEmission && this.lastBatteryLevel === batteryLevel) {
            return;
        }
        this.lastBatteryLevel = batteryLevel;
        this.events$.next({
            timestamp,
            type: 'BATTERY',
            batteryLevel,
        });
    }
    parseData(value) {
        const timestamp = now();
        const raw = [];
        for (let i = 0; i < value.byteLength; i++) {
            raw[i] = value.getUint8(i);
        }
        const decoded = this.encrypter ? this.encrypter.decrypt(raw) : raw;
        if ((decoded[0] | 0) === 171) {
            if (!this.capabilities.gyroscope) {
                this.capabilities.gyroscope = true;
            }
            this.parseGyroData(decoded, timestamp);
            return;
        }
        const bits = decoded.map(b => ((b + 256) & 0xFF).toString(2).padStart(8, '0')).join('');
        const msgType = parseInt(bits.slice(0, 8), 2);
        if (msgType === 161) { // Hardware info
            let devName = '';
            for (let i = 0; i < 8; i++) {
                devName += String.fromCharCode(parseInt(bits.slice(8 + i * 8, 16 + i * 8), 2));
            }
            const hardwareVersion = parseInt(bits.slice(88, 96), 2) + "." + parseInt(bits.slice(96, 104), 2);
            const softwareVersion = parseInt(bits.slice(72, 80), 2) + "." + parseInt(bits.slice(80, 88), 2);
            this.events$.next({
                timestamp,
                type: "HARDWARE",
                hardwareName: devName.trim(),
                softwareVersion,
                hardwareVersion,
                gyroSupported: this.capabilities.gyroscope
            });
        }
        else if (msgType === 163) { // Facelets state
            const seq = parseInt(bits.slice(152, 160), 2);
            this.latestFacelet = parseFacelet$1(bits.slice(8, 152));
            this.prevCubie.fromFacelet(this.latestFacelet);
            this.moveCnt = seq;
            this.prevMoveCnt = seq;
            this.events$.next({
                timestamp,
                type: "FACELETS",
                facelets: this.latestFacelet
            });
        }
        else if (msgType === 164) { // Battery
            this.emitBatteryLevel(parseInt(bits.slice(8, 16), 2), timestamp);
        }
        else if (msgType === 165) { // Move
            this.moveCnt = parseInt(bits.slice(88, 96), 2);
            if (this.moveCnt === this.prevMoveCnt || this.prevMoveCnt === -1)
                return;
            const prevMoves = [];
            const timeOffs = [];
            let invalidMove = false;
            for (let i = 0; i < 5; i++) {
                const m = parseInt(bits.slice(96 + i * 5, 101 + i * 5), 2);
                timeOffs[i] = parseInt(bits.slice(8 + i * 16, 24 + i * 16), 2);
                prevMoves[i] = "FBUDLR".charAt(m >> 1) + " '".charAt(m & 1);
                if (m >= 12) {
                    prevMoves[i] = "U ";
                    invalidMove = true;
                }
            }
            if (!invalidMove) {
                const rawDelta = (this.moveCnt - this.prevMoveCnt) & 0xff;
                if (rawDelta > prevMoves.length) {
                    console.warn('[Moyu32] lost move events', rawDelta - prevMoves.length);
                }
                const moveDiff = Math.min(rawDelta, prevMoves.length);
                this.prevMoveCnt = this.moveCnt;
                let calcTs = this.deviceTime + this.deviceTimeOffset;
                for (let i = moveDiff - 1; i >= 0; i--) {
                    calcTs += timeOffs[i];
                }
                if (!this.deviceTime || Math.abs(timestamp - calcTs) > 2000) {
                    this.deviceTime += timestamp - calcTs;
                }
                for (let i = moveDiff - 1; i >= 0; i--) {
                    const moveNotation = prevMoves[i].trim();
                    const m = "URFDLB".indexOf(moveNotation[0]) * 3 + " 2'".indexOf(moveNotation[1] || ' ');
                    CubieCube.CubeMult(this.prevCubie, CubieCube.moveCube[m], this.curCubie);
                    this.deviceTime += timeOffs[i];
                    const face = Math.floor(m / 3);
                    const direction = m % 3;
                    this.events$.next({
                        timestamp,
                        type: "MOVE",
                        face,
                        direction,
                        move: moveNotation,
                        localTimestamp: i === 0 ? timestamp : null,
                        cubeTimestamp: this.deviceTime
                    });
                    this.events$.next({
                        timestamp,
                        type: "FACELETS",
                        facelets: this.curCubie.toFaceCube()
                    });
                    const tmp = this.curCubie;
                    this.curCubie = this.prevCubie;
                    this.prevCubie = tmp;
                }
                this.deviceTimeOffset = timestamp - this.deviceTime;
            }
        }
    }
    parseGyroData(decoded, timestamp) {
        const dv = new DataView(Uint8Array.from(decoded).buffer);
        const scale = 1073741824; // 2^30
        let w = dv.getInt32(1, true) / scale;
        let x = dv.getInt32(5, true) / scale;
        let y = dv.getInt32(9, true) / scale;
        let z = dv.getInt32(13, true) / scale;
        const len = Math.hypot(w, x, y, z);
        if (len > 0) {
            w /= len;
            x /= len;
            y /= len;
            z /= len;
        }
        this.events$.next({
            timestamp,
            type: "GYRO",
            quaternion: { x, y, z, w }
        });
    }
    async init() {
        this.device.addEventListener('gattserverdisconnected', this.onDisconnect);
        const gatt = await this.device.gatt.connect();
        const service = await gatt.getPrimaryService(SERVICE_UUID$1);
        const chrcts = await service.getCharacteristics();
        this.readChrct = findCharacteristic(chrcts, CHRT_UUID_READ);
        this.writeChrct = findCharacteristic(chrcts, CHRT_UUID_WRITE);
        if (!this.readChrct || !this.writeChrct) {
            throw new Error(!this.readChrct
                ? '[Moyu32] Cannot find required characteristics'
                : '[Moyu32] Cannot find write characteristic');
        }
        this.readChrct.addEventListener('characteristicvaluechanged', this.onStateChanged);
        await this.readChrct.startNotifications();
        // Initialize encryption with MAC
        const macBytes = this.deviceMAC.split(/[:-\s]+/).map(c => parseInt(c, 16));
        this.encrypter = new Moyu32Encrypter(macBytes);
        await this.sendSimpleRequest(161); // Request cube info
        await this.sendSimpleRequest(163); // Request cube status (facelets)
        await this.sendSimpleRequest(164); // Request battery level
        // Some MoYu32 variants require an extra request burst before
        // gyro enable + steady-state status updates begin.
        await this.sendSimpleRequest(161);
        await this.sendSimpleRequest(163);
        await this.sendSimpleRequest(164);
        this.batteryInterval = setInterval(this.pollBattery, 60000);
        await this.sendRequest(Array.from(ENABLE_GYRO_PAYLOAD));
        await this.sendSimpleRequest(163); // Refresh cube status after enabling gyro notifications
    }
    async sendCommand(command) {
        switch (command.type) {
            case "REQUEST_HARDWARE":
                await this.sendSimpleRequest(161);
                break;
            case "REQUEST_FACELETS":
                await this.sendSimpleRequest(163);
                break;
            case "REQUEST_BATTERY":
                this.forceNextBatteryEmission = true;
                await this.sendSimpleRequest(164);
                break;
        }
    }
    async disconnect() {
        if (this.readChrct) {
            this.readChrct.removeEventListener('characteristicvaluechanged', this.onStateChanged);
            await this.readChrct.stopNotifications().catch(() => { });
            this.readChrct = null;
        }
        this.lastBatteryLevel = null;
        this.forceNextBatteryEmission = false;
        if (this.batteryInterval) {
            clearInterval(this.batteryInterval);
            this.batteryInterval = null;
        }
        this.writeChrct = null;
        this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
        this.events$.next({ timestamp: now(), type: "DISCONNECT" });
        this.events$.complete();
        if (this.device.gatt?.connected) {
            this.device.gatt.disconnect();
        }
    }
}
async function connectMoyu32Device(device, macProvider, context) {
    let mac = parseMoyu32MacFromMf(context?.advertisementManufacturerData ?? null);
    mac = mac || getCachedMacForDevice(device);
    if (!mac && macProvider) {
        const r = await macProvider(device, false);
        if (r) {
            mac = r;
        }
    }
    if (!mac) {
        const mfData = await waitForAdvertisements(device, context?.enableAddressSearch ? 8000 : 5000);
        mac = parseMoyu32MacFromMf(mfData);
    }
    if (!mac && context?.enableAddressSearch) {
        const candidates = buildMoyu32MacCandidatesFromName(device.name);
        const timeoutMs = 2000;
        for (let i = 0; i < candidates.length; i++) {
            if (context.signal?.aborted) {
                break;
            }
            context.onStatus?.(`Testing address (${i + 1}/${candidates.length})…`);
            try {
                if (await probeMoyu32Mac(device, candidates[i], {
                    timeoutMs,
                    signal: context.signal,
                })) {
                    mac = candidates[i];
                    break;
                }
            }
            catch {
                /* try next */
            }
        }
    }
    if (!mac && macProvider) {
        const r = await macProvider(device, true);
        if (r) {
            mac = r;
        }
    }
    if (!mac) {
        throw new Error('Unable to determine MoYu32 cube MAC address');
    }
    const conn = new Moyu32Connection(device, mac);
    await conn.init();
    return conn;
}
const moyu32Protocol = {
    nameFilters: [{ namePrefix: '^S' }, { namePrefix: 'WCU_' }, { namePrefix: 'WCU_MY3' }],
    optionalServices: [SERVICE_UUID$1],
    matchesDevice(device) {
        const name = device.name || '';
        return name.startsWith('^S') || name.startsWith('WCU_') || name.startsWith('WCU_MY3');
    },
    gattAffinity(serviceUuids, _device) {
        return serviceUuids.has(normalizeUuid(SERVICE_UUID$1)) ? 110 : 0;
    },
    connect: connectMoyu32Device
};
registerProtocol(moyu32Protocol);

const UUID_SUFFIX$1 = '-0000-1000-8000-00805f9b34fb';
const QIYI_SVC = '0000fff0' + UUID_SUFFIX$1;
const QIYI_CHR = '0000fff6' + UUID_SUFFIX$1;
const QIYI_KEY$1 = [87, 177, 249, 171, 205, 90, 232, 167, 156, 185, 140, 231, 87, 140, 81, 8];
function crc16modbus$1(data) {
    let crc = 0xffff;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc & 1) > 0 ? (crc >> 1) ^ 0xa001 : crc >> 1;
        }
    }
    return crc;
}
/** Same wire as QiYiConnection.sendHello → sendMessage (wake cube for MAC validation). */
function buildEncryptedQiYiHello(mac) {
    const macBytes = mac.split(/[:-\s]+/).map((x) => parseInt(x, 16));
    const content = [0x00, 0x6b, 0x01, 0x00, 0x00, 0x22, 0x06, 0x00, 0x02, 0x08, 0x00];
    for (let i = 5; i >= 0; i--) {
        content.push(macBytes[i] ?? 0);
    }
    const msg = [0xfe];
    msg.push(4 + content.length);
    for (let k = 0; k < content.length; k++) {
        msg.push(content[k]);
    }
    const crc = crc16modbus$1(msg);
    msg.push(crc & 0xff, crc >> 8);
    const npad = (16 - (msg.length % 16)) % 16;
    for (let p = 0; p < npad; p++) {
        msg.push(0);
    }
    return encryptBlocks(new Uint8Array(msg));
}
function encryptBlocks(plain) {
    const cipher = new ModeOfOperation.ecb(new Uint8Array(QIYI_KEY$1));
    const out = new Uint8Array(plain.length);
    for (let i = 0; i < plain.length; i += 16) {
        const block = cipher.encrypt(plain.subarray(i, i + 16));
        out.set(block, i);
    }
    return out.buffer;
}
function decryptBlocks(enc) {
    const view = enc instanceof ArrayBuffer ? new Uint8Array(enc) : new Uint8Array(enc.buffer, enc.byteOffset, enc.byteLength);
    const cipher = new ModeOfOperation.ecb(new Uint8Array(QIYI_KEY$1));
    const out = new Uint8Array(view.length);
    for (let i = 0; i < view.length; i += 16) {
        const block = cipher.decrypt(view.subarray(i, i + 16));
        out.set(block, i);
    }
    return out;
}
/**
 * Returns true if notifications decrypt to plausible QiYi payloads for this MAC.
 */
async function probeQiYiMac(device, mac, options) {
    const timeoutMs = options?.timeoutMs;
    const gatt = device.gatt;
    if (!gatt) {
        return false;
    }
    if (!gatt.connected) {
        await gatt.connect();
    }
    const service = await gatt.getPrimaryService(QIYI_SVC);
    const chrcts = await service.getCharacteristics();
    const chrct = findCharacteristic(chrcts, QIYI_CHR);
    if (!chrct) {
        return false;
    }
    let stopped = false;
    let ok = false;
    const onNotify = (ev) => {
        if (stopped) {
            return;
        }
        const v = ev.target.value;
        if (!v) {
            return;
        }
        try {
            const raw = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
            const dec = decryptBlocks(raw);
            if (isValidQiYiDecryptedPacket(dec)) {
                ok = true;
                stopped = true;
            }
        }
        catch {
            /* ignore */
        }
    };
    chrct.addEventListener('characteristicvaluechanged', onNotify);
    await chrct.startNotifications();
    const wake = () => {
        if (stopped) {
            return;
        }
        try {
            void writeGattCharacteristicValue(chrct, buildEncryptedQiYiHello(mac)).catch(() => { });
        }
        catch {
            /* ignore */
        }
    };
    const iv = setInterval(wake, 100);
    wake();
    await new Promise((resolve) => {
        const maxTimer = setTimeout(() => resolve(), timeoutMs);
        const poll = setInterval(() => {
            if (ok || options?.signal?.aborted) {
                clearInterval(poll);
                clearTimeout(maxTimer);
                resolve();
            }
        }, 40);
    });
    clearInterval(iv);
    stopped = true;
    chrct.removeEventListener('characteristicvaluechanged', onNotify);
    await chrct.stopNotifications().catch(() => { });
    return ok;
}

const UUID_SUFFIX = '-0000-1000-8000-00805f9b34fb';
const SERVICE_UUID = '0000fff0' + UUID_SUFFIX;
const CHRCT_UUID_CUBE = '0000fff6' + UUID_SUFFIX;
const QIYI_CIC_LIST = [0x0504];
const QIYI_KEY = [87, 177, 249, 171, 205, 90, 232, 167, 156, 185, 140, 231, 87, 140, 81, 8];
/** Kociemba facelet string for solved cube */
const QIYI_SOLVED_FACELETS = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
function crc16modbus(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x1) > 0 ? (crc >> 1) ^ 0xa001 : crc >> 1;
        }
    }
    return crc;
}
class QiYiEncrypter {
    constructor() {
        this.cipher = new ModeOfOperation.ecb(new Uint8Array(QIYI_KEY));
    }
    encrypt(data) {
        const result = [];
        for (let i = 0; i < data.length; i += 16) {
            const block = data.slice(i, i + 16);
            const encrypted = this.cipher.encrypt(new Uint8Array(block));
            for (let j = 0; j < 16; j++) {
                result[i + j] = encrypted[j];
            }
        }
        return result;
    }
    decrypt(data) {
        const result = [];
        for (let i = 0; i < data.length; i += 16) {
            const block = data.slice(i, i + 16);
            const decrypted = this.cipher.decrypt(new Uint8Array(block));
            for (let j = 0; j < 16; j++) {
                result[i + j] = decrypted[j];
            }
        }
        return result;
    }
}
function parseFacelet(faceMsg) {
    const ret = [];
    for (let i = 0; i < 54; i++) {
        ret.push("LRDUFB".charAt((faceMsg[i >> 1] >> ((i % 2) << 2)) & 0xf));
    }
    return ret.join("");
}
/** Device timestamps in bytes 3–6 and history slots: big-endian uint32 */
function readQiYiTimestampBE(msg, offset) {
    return (msg[offset] << 24) | (msg[offset + 1] << 16) | (msg[offset + 2] << 8) | msg[offset + 3];
}
/** Collect primary + all 11 history slots (bytes 36..90) */
function collectQiYiStateChangeMoves(msg, headerTs) {
    const out = [[msg[34], headerTs]];
    for (let i = 0; i < 11; i++) {
        const off = 36 + 5 * i;
        if (off + 5 > msg.length)
            break;
        let allFf = true;
        for (let j = 0; j < 5; j++) {
            if (msg[off + j] !== 0xff) {
                allFf = false;
                break;
            }
        }
        if (allFf)
            continue;
        const slotTs = readQiYiTimestampBE(msg, off);
        const code = msg[off + 4];
        out.push([code, slotTs]);
    }
    out.sort((a, b) => a[1] - b[1]);
    const seen = new Set();
    return out.filter(([code, t]) => {
        const k = `${code},${t}`;
        if (seen.has(k))
            return false;
        seen.add(k);
        return true;
    });
}
const QIYI_PROTOCOL = { id: 'qiyi', name: 'QiYi' };
class QiYiConnection {
    constructor(device, mac) {
        this.protocol = QIYI_PROTOCOL;
        this.capabilities = {
            gyroscope: false,
            battery: true,
            facelets: true,
            hardware: true,
            reset: false
        };
        this.cubeChrct = null;
        this.curCubie = new CubieCube();
        this.prevCubie = new CubieCube();
        this.lastTs = 0;
        this.lastBatteryLevel = null;
        this.forceNextBatteryEmission = false;
        this.writeChain = Promise.resolve();
        this.onCubeEvent = (event) => {
            const value = event.target.value;
            if (!value)
                return;
            const encMsg = [];
            for (let i = 0; i < value.byteLength; i++) {
                encMsg[i] = value.getUint8(i);
            }
            const msg = this.encrypter.decrypt(encMsg);
            if (msg[0] === 0xCC && msg[1] === 0x10) {
                this.handleQuaternionPacket(msg);
                return;
            }
            const trimmed = msg.slice(0, msg[1]);
            if (trimmed.length < 3 || crc16modbus(trimmed) !== 0) {
                return;
            }
            this.parseCubeData(trimmed);
        };
        this.onDisconnect = () => {
            this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
            this.lastBatteryLevel = null;
            this.forceNextBatteryEmission = false;
            this.events$.next({ timestamp: now(), type: "DISCONNECT" });
            this.events$.complete();
        };
        this.device = device;
        this.deviceName = device.name || 'QiYi';
        this.deviceMAC = mac;
        this.events$ = new Subject();
        this.encrypter = new QiYiEncrypter();
    }
    sendMessage(content) {
        if (!this.cubeChrct)
            return Promise.reject();
        const ch = this.cubeChrct;
        const run = async () => {
            const msg = [0xfe];
            msg.push(4 + content.length);
            for (let i = 0; i < content.length; i++) {
                msg.push(content[i]);
            }
            const crc = crc16modbus(msg);
            msg.push(crc & 0xff, crc >> 8);
            const npad = (16 - msg.length % 16) % 16;
            for (let i = 0; i < npad; i++) {
                msg.push(0);
            }
            const encMsg = this.encrypter.encrypt(msg);
            await writeGattCharacteristicValue(ch, new Uint8Array(encMsg).buffer);
        };
        this.writeChain = this.writeChain.then(run, run);
        return this.writeChain;
    }
    sendHello() {
        const macBytes = this.deviceMAC.split(/[:-\s]+/).map(c => parseInt(c, 16));
        const content = [0x00, 0x6b, 0x01, 0x00, 0x00, 0x22, 0x06, 0x00, 0x02, 0x08, 0x00];
        for (let i = 5; i >= 0; i--) {
            content.push(macBytes[i] || 0);
        }
        return this.sendMessage(content);
    }
    handleQuaternionPacket(msg) {
        if (msg.length < 16)
            return;
        const expectedCrc = crc16modbus(msg.slice(0, 14));
        const actualCrc = msg[14] | (msg[15] << 8);
        if (expectedCrc !== actualCrc)
            return;
        if (!this.capabilities.gyroscope) {
            this.capabilities.gyroscope = true;
        }
        const dv = new DataView(Uint8Array.from(msg).buffer);
        const ax = dv.getInt16(6, false) / 1000;
        const ay = dv.getInt16(8, false) / 1000;
        const az = dv.getInt16(10, false) / 1000;
        const aw = dv.getInt16(12, false) / 1000;
        this.events$.next({
            timestamp: now(),
            type: "GYRO",
            quaternion: {
                x: ax,
                y: -az,
                z: ay,
                w: aw
            }
        });
    }
    emitHardwareEvent() {
        this.events$.next({
            timestamp: now(),
            type: "HARDWARE",
            hardwareName: this.deviceName,
            gyroSupported: this.capabilities.gyroscope
        });
    }
    emitBatteryLevel(rawLevel, timestamp = now()) {
        if (!Number.isFinite(rawLevel)) {
            return;
        }
        const batteryLevel = Math.min(100, Math.max(0, Math.round(rawLevel)));
        const forceEmission = this.forceNextBatteryEmission;
        this.forceNextBatteryEmission = false;
        if (!forceEmission && this.lastBatteryLevel === batteryLevel) {
            return;
        }
        this.lastBatteryLevel = batteryLevel;
        this.events$.next({
            timestamp,
            type: 'BATTERY',
            batteryLevel,
        });
    }
    parseCubeData(msg) {
        const timestamp = now();
        if (msg[0] !== 0xfe)
            return;
        const opcode = msg[2];
        const ts = readQiYiTimestampBE(msg, 3);
        if (opcode === 0x2) {
            // Hello response — always ACK
            this.sendMessage(msg.slice(2, 7)).catch(() => { });
            const newFacelet = parseFacelet(msg.slice(7, 34));
            this.events$.next({
                timestamp,
                type: "FACELETS",
                facelets: newFacelet
            });
            this.emitBatteryLevel(msg[35], timestamp);
            this.prevCubie.fromFacelet(newFacelet);
            this.lastTs = ts;
            return;
        }
        if (opcode === 0x3) {
            const needsAck = msg.length > 91 && msg[91] !== 0;
            if (needsAck) {
                this.sendMessage(msg.slice(2, 7)).catch(() => { });
            }
            const candidates = collectQiYiStateChangeMoves(msg, ts);
            const newMoves = candidates.filter(([code, moveTs]) => code >= 1 && code <= 12 && moveTs > this.lastTs);
            for (let k = 0; k < newMoves.length; k++) {
                const [code, moveTs] = newMoves[k];
                const axis = [4, 1, 3, 0, 2, 5][(code - 1) >> 1];
                const power = [0, 2][code & 1];
                const m = axis * 3 + power;
                const moveStr = ("URFDLB".charAt(axis) + " 2'".charAt(power)).trim();
                CubieCube.CubeMult(this.prevCubie, CubieCube.moveCube[m], this.curCubie);
                const facelet = this.curCubie.toFaceCube();
                this.events$.next({
                    timestamp,
                    type: "MOVE",
                    face: axis,
                    direction: power === 0 ? 0 : 1,
                    move: moveStr,
                    localTimestamp: k === newMoves.length - 1 ? timestamp : null,
                    cubeTimestamp: Math.trunc(moveTs / 1.6)
                });
                this.events$.next({
                    timestamp,
                    type: "FACELETS",
                    facelets: facelet
                });
                const tmp = this.curCubie;
                this.curCubie = this.prevCubie;
                this.prevCubie = tmp;
            }
            if (newMoves.length > 0) {
                this.lastTs = newMoves[newMoves.length - 1][1];
            }
            this.emitBatteryLevel(msg[35], timestamp);
            return;
        }
        if (opcode === 0x4) {
            // Sync confirmation: emit solved state; no ACK for op 4 in reference protocol.
            if (msg[1] !== 38)
                return;
            this.events$.next({
                timestamp,
                type: "FACELETS",
                facelets: QIYI_SOLVED_FACELETS
            });
            this.prevCubie.fromFacelet(QIYI_SOLVED_FACELETS);
            this.lastTs = ts;
            return;
        }
        // Unknown opcode: do not advance lastTs (avoids skewing move history filters).
    }
    async init() {
        this.device.addEventListener('gattserverdisconnected', this.onDisconnect);
        const gatt = await this.device.gatt.connect();
        const service = await gatt.getPrimaryService(SERVICE_UUID);
        const chrcts = await service.getCharacteristics();
        this.cubeChrct = findCharacteristic(chrcts, CHRCT_UUID_CUBE);
        if (!this.cubeChrct) {
            throw new Error('[QiYi] Cannot find required characteristic');
        }
        this.cubeChrct.addEventListener('characteristicvaluechanged', this.onCubeEvent);
        await this.cubeChrct.startNotifications();
        await this.sendHello();
    }
    async sendCommand(command) {
        if (command.type === "REQUEST_FACELETS" || command.type === "REQUEST_BATTERY") {
            if (command.type === "REQUEST_BATTERY") {
                this.forceNextBatteryEmission = true;
            }
            await this.sendHello();
        }
        else if (command.type === "REQUEST_HARDWARE") {
            this.emitHardwareEvent();
        }
    }
    async disconnect() {
        if (this.cubeChrct) {
            this.cubeChrct.removeEventListener('characteristicvaluechanged', this.onCubeEvent);
            await this.cubeChrct.stopNotifications().catch(() => { });
            this.cubeChrct = null;
        }
        this.lastBatteryLevel = null;
        this.forceNextBatteryEmission = false;
        this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
        this.events$.next({ timestamp: now(), type: "DISCONNECT" });
        this.events$.complete();
        if (this.device.gatt?.connected) {
            this.device.gatt.disconnect();
        }
    }
}
function parseQiYiMacFromMf(mfData) {
    if (!mfData) {
        return null;
    }
    return extractMacFromManufacturerData(mfData, QIYI_CIC_LIST, true);
}
async function connectQiYiDevice(device, macProvider, context) {
    let mac = parseQiYiMacFromMf(context?.advertisementManufacturerData ?? null);
    mac = mac || getCachedMacForDevice(device);
    if (!mac && macProvider) {
        const r = await macProvider(device, false);
        if (r) {
            mac = r;
        }
    }
    if (!mac) {
        const mfData = await waitForAdvertisements(device, context?.enableAddressSearch ? 8000 : 5000);
        mac = parseQiYiMacFromMf(mfData);
    }
    if (!mac) {
        const c = buildQiYiMacCandidatesFromName(device.name);
        if (c.length === 1) {
            mac = c[0];
        }
    }
    if (!mac && context?.enableAddressSearch) {
        const candidates = buildQiYiMacCandidatesFromName(device.name);
        const timeoutMs = 3000;
        for (let i = 0; i < candidates.length; i++) {
            if (context.signal?.aborted) {
                break;
            }
            context.onStatus?.(`Testing address (${i + 1}/${candidates.length})…`);
            try {
                if (await probeQiYiMac(device, candidates[i], {
                    timeoutMs,
                    signal: context.signal,
                })) {
                    mac = candidates[i];
                    break;
                }
            }
            catch {
                /* try next */
            }
        }
    }
    if (!mac && macProvider) {
        const r = await macProvider(device, true);
        if (r) {
            mac = r;
        }
    }
    if (!mac) {
        throw new Error('Unable to determine QiYi cube MAC address');
    }
    const conn = new QiYiConnection(device, mac);
    await conn.init();
    return conn;
}
const qiyiProtocol = {
    nameFilters: [
        { namePrefix: "QY-QYSC" },
        { namePrefix: "XMD-TornadoV4-i" }
    ],
    optionalServices: [SERVICE_UUID],
    optionalManufacturerData: QIYI_CIC_LIST,
    matchesDevice(device) {
        const name = device.name || '';
        return name.startsWith('QY-QYSC') || name.startsWith('XMD-TornadoV4-i');
    },
    gattAffinity(serviceUuids, _device) {
        return serviceUuids.has(normalizeUuid(SERVICE_UUID)) ? 110 : 0;
    },
    connect: connectQiYiDevice
};
registerProtocol(qiyiProtocol);

/**
 * Consolidated GATT service UUIDs for pairing so the OS grants access across vendors.
 */
const S = '-0000-1000-8000-00805f9b34fb';
const DEVICE_INFORMATION_SERVICE = '0000180a' + S;
const GENERIC_ACCESS_SERVICE = '00001800' + S;
/** QiYi primary (16-bit FFF0). */
const QIYI_LIKE_FFF0 = '0000fff0' + S;
/** MoYu plain (MHC). */
const MOYU_PLAIN_SERVICE = '00001000' + S;
/** MoYu32 / WCU. */
const MOYU32_SERVICE = '0783b03e-7735-b5a0-1760-a305d2795cb0';
/** Giiker. */
const GIIKER_DATA_SERVICE = '0000aadb' + S;
const GIIKER_CTRL_SERVICE = '0000aaaa' + S;
/** GoCube UART. */
const GOCUBE_UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
/**
 * Union of services commonly needed when connecting smart cubes via Web Bluetooth.
 */
const DEFAULT_SMARTCUBE_OPTIONAL_SERVICES = [
    GENERIC_ACCESS_SERVICE,
    DEVICE_INFORMATION_SERVICE,
    GAN_GEN2_SERVICE,
    GAN_GEN2_COMMAND_CHARACTERISTIC,
    GAN_GEN2_STATE_CHARACTERISTIC,
    GAN_GEN3_SERVICE,
    GAN_GEN3_COMMAND_CHARACTERISTIC,
    GAN_GEN3_STATE_CHARACTERISTIC,
    GAN_GEN4_SERVICE,
    GAN_GEN4_COMMAND_CHARACTERISTIC,
    GAN_GEN4_STATE_CHARACTERISTIC,
    QIYI_LIKE_FFF0,
    MOYU_PLAIN_SERVICE,
    MOYU32_SERVICE,
    GIIKER_DATA_SERVICE,
    GIIKER_CTRL_SERVICE,
    GOCUBE_UART_SERVICE,
];
function mergeOptionalServiceUuids(protocolServices) {
    const u = new Set(DEFAULT_SMARTCUBE_OPTIONAL_SERVICES);
    for (const s of protocolServices) {
        u.add(s);
    }
    return Array.from(u);
}

/**
 * Extra Web Bluetooth scan filters when reconnecting with a known advertised name.
 */
/** Wildcard-style names some stacks use for GAN advertising aliases. */
function extraScanFiltersForKnownDeviceName(deviceName) {
    if (!deviceName) {
        return [];
    }
    const n = deviceName.trim();
    if (!n) {
        return [];
    }
    const out = [{ name: n }];
    if (n.startsWith('GANic')) {
        out.push({ name: 'GANicXXX' });
    }
    if (n.startsWith('GANi3')) {
        out.push({ name: 'GANi3XXX' });
    }
    if (n.startsWith('AiCube')) {
        out.push({ name: 'AiCubeXXX' });
    }
    return out;
}

function mergeManufacturerCompanyIds(protocols) {
    const all = new Set();
    for (const p of protocols) {
        if (p.optionalManufacturerData) {
            for (const cic of p.optionalManufacturerData) {
                all.add(cic);
            }
        }
    }
    return Array.from(all).sort((a, b) => a - b);
}
/**
 * Build Web Bluetooth `requestDevice` options for the given mode.
 * Manufacturer IDs appear in `filters` (OR with name filters) and in `optionalManufacturerData`
 * so `watchAdvertisements` exposes manufacturer data when the device matched by name prefix.
 */
function buildRequestDeviceOptions(protocols, mode, extras) {
    const protocolServices = [];
    for (const p of protocols) {
        for (const s of p.optionalServices) {
            protocolServices.push(s);
        }
    }
    const optionalServices = mergeOptionalServiceUuids(protocolServices);
    const cics = mergeManufacturerCompanyIds(protocols);
    const optionalManufacturerData = cics.length > 0 ? cics : undefined;
    if (mode === 'any') {
        return {
            acceptAllDevices: true,
            optionalServices,
            optionalManufacturerData,
        };
    }
    const filters = [];
    for (const p of protocols) {
        for (const f of p.nameFilters) {
            filters.push(f);
        }
    }
    for (const f of extraScanFiltersForKnownDeviceName(extras?.deviceName)) {
        filters.push(f);
    }
    for (const companyIdentifier of cics) {
        filters.push({
            manufacturerData: [{ companyIdentifier }],
        });
    }
    return {
        filters,
        optionalServices,
        optionalManufacturerData,
    };
}

const GATT_CONNECT_TIMEOUT_MS = 25000;
const GATT_RETRY_MAX = 2;
const GATT_RETRY_BASE_DELAY_MS = 150;
function disconnectGattSafe(gatt) {
    return Promise.resolve(gatt.disconnect()).catch(() => { });
}
async function delay(ms) {
    await new Promise((r) => setTimeout(r, ms));
}
async function connectGattWithTimeout(gatt, timeoutMs) {
    const sym = Symbol('gattTimeout');
    try {
        await Promise.race([
            gatt.connect(),
            new Promise((_, rej) => setTimeout(() => rej(sym), timeoutMs)),
        ]);
    }
    catch (e) {
        if (e === sym) {
            await disconnectGattSafe(gatt);
            throw new Error('GATT connection timeout');
        }
        await disconnectGattSafe(gatt).catch(() => { });
        throw e;
    }
}
/**
 * Connect GATT (if needed) and return normalized primary service UUIDs.
 * Uses a connect timeout and limited retries on transient failures.
 */
async function collectPrimaryServiceUuids(device) {
    const gatt = device.gatt;
    if (!gatt) {
        throw new Error('GATT unavailable on this device');
    }
    let lastErr;
    for (let attempt = 0; attempt <= GATT_RETRY_MAX; attempt++) {
        try {
            await connectGattWithTimeout(gatt, GATT_CONNECT_TIMEOUT_MS);
            const services = await gatt.getPrimaryServices();
            const set = new Set();
            for (const s of services) {
                set.add(normalizeUuid(s.uuid));
            }
            return set;
        }
        catch (e) {
            lastErr = e;
            await disconnectGattSafe(gatt);
            if (attempt < GATT_RETRY_MAX) {
                await delay(GATT_RETRY_BASE_DELAY_MS * (attempt + 1));
            }
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Pick the protocol that best matches the GATT profile. Tie-break with `matchesDevice` (name).
 */
function resolveProtocolByGatt(protocols, serviceUuids, device) {
    const ranked = protocols.map((p) => ({
        p,
        score: p.gattAffinity(serviceUuids, device),
    }));
    const maxScore = ranked.reduce((m, r) => Math.max(m, r.score), -1);
    if (maxScore > 0) {
        const top = ranked.filter((r) => r.score === maxScore);
        const preferred = top.find((r) => r.p.matchesDevice(device));
        return (preferred ?? top[0]).p;
    }
    for (const p of protocols) {
        if (p.matchesDevice(device)) {
            return p;
        }
    }
    return null;
}

/**
 * MoYu-style payloads always yield 54-char FACELETS from {U,F,R,B,L,D} even when AES decrypt is wrong;
 * event-type checks are insufficient. A legal 3×3 state requires consistent sticker counts + geometry.
 */
function isMacCacheProofEvent(e) {
    if (e.type === 'FACELETS') {
        return new CubieCube().fromFacelet(e.facelets) !== -1;
    }
    return e.type === 'MOVE' && e.move.trim().length > 0;
}
const MAC_VERIFY_TIMEOUT_MS = 10000;
/**
 * After we subscribe for MAC proof, ask the cube for a fresh report. Init often emits
 * FACELETS before this subscription exists (Subject does not replay), so without this
 * we can time out even with a correct MAC. Fire-and-forget so a stuck write cannot
 * block verification or leave the UI on "Verifying…" indefinitely.
 */
function requestFreshStateForMacVerify(conn) {
    const c = conn.capabilities;
    const requests = [];
    if (c.facelets) {
        requests.push(conn.sendCommand({ type: 'REQUEST_FACELETS' }));
    }
    if (c.hardware) {
        requests.push(conn.sendCommand({ type: 'REQUEST_HARDWARE' }));
    }
    if (c.battery) {
        requests.push(conn.sendCommand({ type: 'REQUEST_BATTERY' }));
    }
    const p = requests.length
        ? Promise.allSettled(requests).then(() => undefined)
        : Promise.resolve();
    p.catch(() => { });
}
/**
 * Wait until we see decrypted/valid cube traffic so we do not persist a wrong MAC
 * (GAN / MoYu32 / QiYi can complete GATT setup before crypto is proven).
 */
function waitForVerifiedCubeEvent(conn, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        let sub;
        const cleanup = () => {
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
            sub?.unsubscribe();
            sub = undefined;
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
        };
        const finish = (action) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            action();
        };
        const onAbort = () => {
            finish(() => reject(new DOMException('Aborted', 'AbortError')));
        };
        if (signal) {
            if (signal.aborted) {
                finish(() => reject(new DOMException('Aborted', 'AbortError')));
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }
        timer = setTimeout(() => {
            finish(() => reject(new TimeoutError({
                seen: 0,
                lastValue: null,
                meta: null,
            })));
        }, timeoutMs);
        sub = conn.events$.pipe(filter(isMacCacheProofEvent), take(1)).subscribe({
            next: () => {
                finish(() => resolve());
            },
            error: (err) => {
                finish(() => reject(err));
            },
        });
    });
}
function isMacAddressProvider(x) {
    return typeof x === 'function';
}
function normalizeOptions(arg) {
    if (arg === undefined) {
        return {};
    }
    if (isMacAddressProvider(arg)) {
        return { macAddressProvider: arg };
    }
    return arg;
}
async function connectSmartCube(arg) {
    const opts = normalizeOptions(arg);
    const protocols = getRegisteredProtocols();
    if (protocols.length === 0) {
        throw new Error('No smartcube protocols registered');
    }
    const mode = opts.deviceSelection ?? 'filtered';
    const requestOptions = buildRequestDeviceOptions(protocols, mode, {
        deviceName: opts.deviceName,
    });
    opts.onStatus?.('Select your cube…');
    const device = await navigator.bluetooth.requestDevice(requestOptions);
    opts.onStatus?.('Reading advertisements…');
    const advertisementManufacturerData = await waitForManufacturerData(device, opts.enableAddressSearch ? 8000 : 2500);
    opts.onStatus?.('Connecting…');
    const serviceUuids = await collectPrimaryServiceUuids(device);
    const protocol = resolveProtocolByGatt(protocols, serviceUuids, device);
    if (!protocol) {
        try {
            device.gatt?.disconnect();
        }
        catch {
            /* ignore */
        }
        throw new Error("Selected device doesn't match any registered smartcube protocol");
    }
    const context = {
        serviceUuids,
        advertisementManufacturerData,
        enableAddressSearch: opts.enableAddressSearch === true,
        onStatus: opts.onStatus,
        signal: opts.signal,
    };
    let conn;
    try {
        conn = await protocol.connect(device, opts.macAddressProvider, context);
    }
    catch (e) {
        try {
            device.gatt?.disconnect();
        }
        catch {
            /* ignore */
        }
        throw e;
    }
    if (conn.deviceMAC) {
        opts.onStatus?.('Verifying connection…');
        try {
            const verifyPromise = waitForVerifiedCubeEvent(conn, MAC_VERIFY_TIMEOUT_MS, opts.signal);
            requestFreshStateForMacVerify(conn);
            await verifyPromise;
        }
        catch (e) {
            const aborted = e instanceof DOMException && e.name === 'AbortError';
            if (!aborted) {
                removeCachedMacForDevice(device);
            }
            try {
                device.gatt?.disconnect();
            }
            catch {
                /* ignore */
            }
            if (aborted) {
                throw e;
            }
            if (e instanceof TimeoutError) {
                throw new Error('Timed out waiting for cube data. Check the Bluetooth MAC address and try again.');
            }
            throw e;
        }
        setCachedMacForDevice(device, conn.deviceMAC);
    }
    return conn;
}

export { GanTimerState, connectGanCube, connectGanTimer, connectSmartCube, cubeTimestampCalcSkew, cubeTimestampLinearFit, getCachedMacForDevice, getRegisteredProtocols, makeTime, makeTimeFromTimestamp, now, registerProtocol, removeCachedMacForDevice, toKociembaFacelets };
