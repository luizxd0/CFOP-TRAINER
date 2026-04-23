/** LZ-compressed key blobs for GAN gen1 `deriveKey`. */
export declare const GAN_GEN1_COMPRESSED_KEYS: readonly ["NoRgnAHANATADDWJYwMxQOxiiEcfYgSK6Hpr4TYCs0IG1OEAbDszALpA", "NoNg7ANATFIQnARmogLBRUCs0oAYN8U5J45EQBmFADg0oJAOSlUQF0g", "NoRgNATGBs1gLABgQTjCeBWSUDsYBmKbCeMADjNnXxHIoIF0g", "NoRg7ANAzBCsAMEAsioxBEIAc0Cc0ATJkgSIYhXIjhMQGxgC6QA", "NoVgNAjAHGBMYDYCcdJgCwTFBkYVgAY9JpJYUsYBmAXSA", "NoRgNAbAHGAsAMkwgMyzClH0LFcArHnAJzIqIBMGWEAukA"];
/** GAN gen1 primary GATT service (356i “API v1”). */
export declare const GAN_GEN1_PRIMARY_SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb";
/** Standard Device Information service (gen1 key derivation). */
export declare const GAN_GEN1_DEVICE_INFO_SERVICE = "0000180a-0000-1000-8000-00805f9b34fb";
export declare const GAN_GEN1_CHR_FIRMWARE = "00002a28-0000-1000-8000-00805f9b34fb";
export declare const GAN_GEN1_CHR_HARDWARE = "00002a23-0000-1000-8000-00805f9b34fb";
export declare const GAN_GEN1_CHR_STATE = "0000fff5-0000-1000-8000-00805f9b34fb";
export declare const GAN_GEN1_CHR_MOVES = "0000fff6-0000-1000-8000-00805f9b34fb";
export declare const GAN_GEN1_CHR_GYRO_NOTIFY = "0000fff4-0000-1000-8000-00805f9b34fb";
export declare const GAN_GEN1_CHR_BATTERY = "0000fff7-0000-1000-8000-00805f9b34fb";
export declare const GAN_GEN1_CHR_FACELETS = "0000fff2-0000-1000-8000-00805f9b34fb";
/** GAN Gen2 protocol BLE service */
export declare const GAN_GEN2_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dc4179";
/** GAN Gen2 protocol BLE command characteristic */
export declare const GAN_GEN2_COMMAND_CHARACTERISTIC = "28be4a4a-cd67-11e9-a32f-2a2ae2dbcce4";
/** GAN Gen2 protocol BLE state characteristic */
export declare const GAN_GEN2_STATE_CHARACTERISTIC = "28be4cb6-cd67-11e9-a32f-2a2ae2dbcce4";
/** GAN Gen3 protocol BLE service */
export declare const GAN_GEN3_SERVICE = "8653000a-43e6-47b7-9cb0-5fc21d4ae340";
/** GAN Gen3 protocol BLE command characteristic */
export declare const GAN_GEN3_COMMAND_CHARACTERISTIC = "8653000c-43e6-47b7-9cb0-5fc21d4ae340";
/** GAN Gen3 protocol BLE state characteristic */
export declare const GAN_GEN3_STATE_CHARACTERISTIC = "8653000b-43e6-47b7-9cb0-5fc21d4ae340";
/** GAN Gen4 protocol BLE service */
export declare const GAN_GEN4_SERVICE = "00000010-0000-fff7-fff6-fff5fff4fff0";
/** GAN Gen4 protocol BLE command characteristic */
export declare const GAN_GEN4_COMMAND_CHARACTERISTIC = "0000fff5-0000-1000-8000-00805f9b34fb";
/** GAN Gen4 protocol BLE state characteristic */
export declare const GAN_GEN4_STATE_CHARACTERISTIC = "0000fff6-0000-1000-8000-00805f9b34fb";
/** List of Company Identifier Codes, fill with all values [0x0001, 0xFF01] possible for GAN cubes */
export declare const GAN_CIC_LIST: number[];
/**  List of encryption keys */
export declare const GAN_ENCRYPTION_KEYS: {
    key: number[];
    iv: number[];
}[];
//# sourceMappingURL=gan-cube-definitions.d.ts.map