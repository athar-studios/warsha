// Orchestrator read-only APK inspector: lists the APK Signing Block pairs (ID + length) and any
// source-map entries in the zip. Reads public structure only; prints no key material.
const fs = require('fs');
const f = process.argv[2];
const b = fs.readFileSync(f);
console.log('file bytes=' + b.length);

// End Of Central Directory
let eocd = -1;
for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
  if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) { console.log('no EOCD'); process.exit(1); }
const cdSize = b.readUInt32LE(eocd + 12);
const cdOff = b.readUInt32LE(eocd + 16);
const entries = b.readUInt16LE(eocd + 10);
console.log('central directory offset=' + cdOff + ' size=' + cdSize + ' entries=' + entries);

// zip entry names (central directory)
const names = [];
let p = cdOff;
for (let n = 0; n < entries; n++) {
  if (b.readUInt32LE(p) !== 0x02014b50) break;
  const nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), cmtLen = b.readUInt16LE(p + 32);
  const crc = b.readUInt32LE(p + 16), usize = b.readUInt32LE(p + 24);
  names.push({ name: b.toString('utf8', p + 46, p + 46 + nameLen), crc: crc.toString(16), usize });
  p += 46 + nameLen + extraLen + cmtLen;
}
const maps = names.filter(x => /\.map$/i.test(x.name));
console.log('zip entries parsed=' + names.length + '; *.map entries=' + maps.length);
maps.forEach(x => console.log('  MAP ENTRY: ' + x.name + ' size=' + x.usize + ' crc=' + x.crc));
const pub = names.filter(x => /^assets\/public\//.test(x.name));
console.log('assets/public entries=' + pub.length);
pub.slice(0, 40).forEach(x => console.log('  ' + x.name + ' size=' + x.usize + ' crc=' + x.crc));

// APK Signing Block
const magic = b.toString('latin1', cdOff - 16, cdOff);
console.log('signing block magic="' + magic + '"');
if (magic !== 'APK Sig Block 42') { console.log('no APK Signing Block'); process.exit(0); }
const blockSize = Number(b.readBigUInt64LE(cdOff - 24));
const blockStart = cdOff - blockSize - 8;
console.log('signing block start=' + blockStart + ' declared size=' + blockSize);
const known = {
  0x7109871a: 'APK Signature Scheme v2',
  0xf05368c0: 'APK Signature Scheme v3',
  0x1b93ad61: 'APK Signature Scheme v3.1',
  0x6dff800d: 'source stamp v1',
  0x504b4453: 'DEPENDENCY METADATA (Android Gradle Plugin, encrypted for Google Play)',
  0x42726577: 'verity padding',
  0x71777777: 'zipalign padding',
};
let q = blockStart + 8;
const end = cdOff - 24;
while (q < end) {
  const len = Number(b.readBigUInt64LE(q));
  const id = b.readUInt32LE(q + 8);
  const label = known[id] || 'unknown';
  console.log('  pair id=0x' + id.toString(16) + ' valueBytes=' + (len - 4) + '  -> ' + label);
  q += 8 + len;
}