// Orchestrator read-only APK v2 inspector. Prints ONLY public structure: signer count, the signature
// algorithm id(s) and the signature byte length. It never prints signature bytes, public keys or
// certificates, and never touches key material.
const fs = require('fs');
const b = fs.readFileSync(process.argv[2]);
let eocd = -1;
for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
const cdOff = b.readUInt32LE(eocd + 16);
const blockSize = Number(b.readBigUInt64LE(cdOff - 24));
const blockStart = cdOff - blockSize - 8;
const ALGO = {
  0x0101: 'RSASSA-PSS with SHA2-256 (RANDOMIZED salt)',
  0x0102: 'RSASSA-PSS with SHA2-512 (RANDOMIZED salt)',
  0x0103: 'RSASSA-PKCS1-v1_5 with SHA2-256 (DETERMINISTIC)',
  0x0104: 'RSASSA-PKCS1-v1_5 with SHA2-512 (DETERMINISTIC)',
  0x0201: 'ECDSA with SHA2-256 (randomized unless RFC6979)',
  0x0202: 'ECDSA with SHA2-512',
  0x0301: 'DSA with SHA2-256',
  0x0421: 'Verity RSASSA-PKCS1-v1_5 SHA2-256',
  0x0423: 'Verity ECDSA SHA2-256',
};
let q = blockStart + 8;
const end = cdOff - 24;
while (q < end) {
  const len = Number(b.readBigUInt64LE(q));
  const id = b.readUInt32LE(q + 8);
  if (id === 0x7109871a) {
    let p = q + 12;
    const signersLen = b.readUInt32LE(p); p += 4;
    const signersEnd = p + signersLen;
    let n = 0;
    while (p < signersEnd) {
      const signerLen = b.readUInt32LE(p); p += 4;
      const signerEnd = p + signerLen;
      const signedLen = b.readUInt32LE(p); p += 4 + signedLen;       // skip signed data
      const sigsLen = b.readUInt32LE(p); p += 4;
      const sigsEnd = p + sigsLen;
      while (p < sigsEnd) {
        const recLen = b.readUInt32LE(p); p += 4;
        const algo = b.readUInt32LE(p);
        const sigLen = b.readUInt32LE(p + 4);
        console.log('signer #' + (n + 1) + ': algorithm id=0x' + algo.toString(16).padStart(4, '0') + ' -> ' + (ALGO[algo] || 'unknown') + '; signature length=' + sigLen + ' bytes');
        p += recLen;
      }
      p = signerEnd;
      n++;
    }
    console.log('v2 signers=' + n);
  }
  q += 8 + len;
}