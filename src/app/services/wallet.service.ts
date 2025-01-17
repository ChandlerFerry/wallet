import { Injectable } from '@angular/core';
import { bytes32ToString } from 'src/lib/qubic/converter/converter';
import { IConfig } from '../model/config';
import { IDecodedSeed, ISeed } from '../model/seed';
import { ITx } from '../model/tx';

@Injectable({
  providedIn: 'root'
})
export class WalletService {

  private configName = 'wallet-config';
  public privateKey: CryptoKey | null = null;
  public publicKey: CryptoKey | null = null;
  public seeds: ISeed[] = [];
  public txs: ITx[] = [];
  public configError = false;
  public erroredCOnfig: string = '';
  public shouldExportKey = true;

  private rsaAlg = {
    name: 'RSA-OAEP',
    modulusLength: 4096,
    publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    hash: { name: 'SHA-256' },
  };
  private aesAlg = {
    name: "AES-GCM",
    length: 256,
    iv: new Uint8Array(12).fill(0),
  };
  private encAlg = {
    name: 'RSA-OAEP',
  };

  constructor() {
    this.load();
  }

  private load(): void {
    this.loadConfigFromStorage();
  }

  private loadConfigFromStorage() {
    const jsonString = localStorage.getItem(this.configName);
    if (jsonString) {
      try {
        const config = JSON.parse(jsonString);
        this.loadConfig(config);
      } catch (e) {
        this.configError = true;
        this.erroredCOnfig = jsonString;
      }
    }
  }

  private loadConfig(config: IConfig) {

    if (config.publicKey)
      crypto.subtle.importKey("jwk", config.publicKey, this.rsaAlg, true, ['encrypt']).then(k =>
        this.publicKey = k
      );
    if (config.seeds)
      this.seeds = config.seeds;

  }

  public createNewKeys() {
    this.generateKey().then((k: CryptoKeyPair) => {
      this.setKeys(k.publicKey, k.privateKey);
    });
  }

  private save(lock: boolean = false): void {
    this.saveConfig(lock);
  }

  public getSeeds(): ISeed[] {
    var seeds = [...this.seeds];
    return seeds.sort((a, b) => {
      const nameA = a.alias.toUpperCase(); // ignore upper and lowercase
      const nameB = b.alias.toUpperCase(); // ignore upper and lowercase
      if (nameA < nameB) {
        return -1;
      }
      if (nameA > nameB) {
        return 1;
      }

      // names must be equal
      return 0;
    });
  }
  public getSeed(publicId: string): ISeed | undefined {
    return this.seeds.find(f => f.publicId === publicId);
  }
  public revealSeed(publicId: string): Promise<string> {
    const seed = this.getSeed(publicId);
    return this.decrypt(this.privateKey!, this.base64ToArrayBuffer(seed?.encryptedSeed!)).then(result => {
      return new TextDecoder().decode(result);
    });

  }
  public updateSeedAlias(publicId: string, alias: string) {
    let seed = this.getSeed(publicId);
    if (seed){
      seed.alias = alias;
      this.saveConfig(false);
    }
  }

  arrayBufferToBase64(buffer: ArrayBuffer) {
    var binary = '';
    var bytes = new Uint8Array(buffer);
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }



  base64ToArrayBuffer(base64: string) {
    var binary_string = atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }

  public addSeed(seed: IDecodedSeed): Promise<ISeed> {
    return this.encrypt(seed.seed).then(encryptedSeed => {
      const newSeed = <ISeed>{
        encryptedSeed: btoa(String.fromCharCode(...new Uint8Array(encryptedSeed))),
        alias: seed.alias,
        //publicKey: seed.publicKey,
        publicId: seed.publicId
      }
      this.seeds.push(newSeed);
      this.save();
      return newSeed;
    });
  }

  deleteSeed(publicId: string) {
    this.seeds = this.seeds.filter(f => f.publicId !== publicId);
    this.save();
  }

  private async generateKey() {
    const key = await crypto.subtle.generateKey(this.rsaAlg, true,
      ['encrypt', 'decrypt']);
    return key;
  }

  private async decrypt(privateKey: CryptoKey, message: ArrayBuffer): Promise<ArrayBuffer> {
    const msg = await crypto.subtle.decrypt(this.encAlg, privateKey, message);
    return msg;
  }

  private async encrypt(message: string): Promise<ArrayBuffer> {
    return crypto.subtle.encrypt(this.encAlg, this.publicKey!, new TextEncoder().encode(message)).then(emessage => {
      return emessage;
    });
  }

  private saveConfig(lock: boolean) {
    if (lock) { // when locking we don't want that the public key is saved.
      const config = {
        seeds: this.seeds
      };
      localStorage.setItem(this.configName, JSON.stringify(config));
    } else {
      crypto.subtle.exportKey('jwk', this.publicKey!).then(jwk => {
        const config: IConfig = {
          publicKey: jwk,
          seeds: this.seeds
        };
        localStorage.setItem(this.configName, JSON.stringify(config));
      });
    }
  }

  public lock() {
    this.save(true);
    this.privateKey = null;
    this.publicKey = null;
  }

  private setKeys(publicKey: CryptoKey, privateKey: CryptoKey | null = null) {
    this.publicKey = publicKey;
    if (privateKey)
      this.privateKey = privateKey;
  }

  public async unlock(data: ArrayBuffer, password: string): Promise<boolean> {
    return this.import(data, password).then(({ privateKey, publicKey }) => {
      this.shouldExportKey = false;
      this.setKeys(publicKey, privateKey);
      this.save();
      return true;
    });
  }

  async getPublicKey(privateKey: CryptoKey) {
    const jwkPrivate = await crypto.subtle.exportKey("jwk", privateKey);
    delete jwkPrivate.d;
    jwkPrivate.key_ops = ["encrypt"];
    return crypto.subtle.importKey("jwk", jwkPrivate, this.rsaAlg, true, ["encrypt"]);
  }

  async import(wrappedKey: ArrayBuffer, password: string): Promise<{ privateKey: CryptoKey, publicKey: CryptoKey }> {
    return this.importKey(password).then((pwKey: CryptoKey) => {
      return this.deriveKey(pwKey).then((wrapKey: CryptoKey) => {
        return crypto.subtle.unwrapKey("jwk", wrappedKey, wrapKey, this.aesAlg, this.rsaAlg, true, ["decrypt"]).then(privateKey => {
          return this.getPublicKey(privateKey).then(publicKey => {
            return { privateKey, publicKey };
          });
        });
      });
    });

  }

  private async importKey(password: string) {
    const enc = new TextEncoder();
    const pw = enc.encode(password);

    return (<any>crypto.subtle).importKey(
      "raw",
      pw,
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );
  }

  private async deriveKey(pwKey: CryptoKey) {
    const salt = new Uint8Array(16).fill(0);
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 100000,
        hash: "SHA-256",
      },
      pwKey,
      this.aesAlg,
      true,
      ["wrapKey", "unwrapKey"]
    )
  }

  public async exportKey(password: string) {
    if (!this.privateKey)
      return Promise.resolve();

    return this.importKey(password).then((pwKey: CryptoKey) => {
      this.deriveKey(pwKey).then((wrapKey: CryptoKey) => {
        crypto.subtle.wrapKey("jwk", this.privateKey!, wrapKey, this.aesAlg).then((jsonKey) => {
          const blob = new Blob([jsonKey], { type: 'application/octet-stream' });
          this.downloadBlob("qubic.li-wallet.privatekey", blob);
          this.shouldExportKey = false;
        });
      });
    });
  }

  public importConfig(config: IConfig): boolean {
    if (!config || config.seeds.length <= 0)
      return false;

    this.loadConfig(config);
    this.saveConfig(false);

    return true;
  }

  public exportConfig(): boolean {
    if (!this.seeds || this.seeds.length <= 0)
      return false;

    const exportConfig: IConfig = {
      seeds: this.seeds
    };

    const data = new TextEncoder().encode(JSON.stringify(exportConfig));
    const blob = new Blob([data], { type: 'application/octet-stream' });
    this.downloadBlob("qubic.li-wallet.config", blob);

    return true;
  }

  private downloadBlob(fileName: string, blob: Blob): void {
    if ((<any>window.navigator).msSaveOrOpenBlob) {
      (<any>window.navigator).msSaveBlob(blob, fileName);
    } else {
      const anchor = window.document.createElement('a');
      anchor.href = window.URL.createObjectURL(blob);
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(anchor.href);
    }
  }

  public clearConfig() {
    localStorage.removeItem(this.configName);
    this.seeds = [];
    this.publicKey = null;
  }

  public resetConfig() {
    this.clearConfig();
    location.reload();
  }

  private arrayBufferToString(buff: ArrayBuffer) {
    return String.fromCharCode.apply(null, new Uint16Array(buff) as unknown as number[]);
  }

  private stringToArrayBuffer(str: string) {
    const buff = new ArrayBuffer(str.length * 2) // Because there are 2 bytes for each char.
    const buffView = new Uint16Array(buff);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
      buffView[i] = str.charCodeAt(i);
    }
    return buff;
  }

}
