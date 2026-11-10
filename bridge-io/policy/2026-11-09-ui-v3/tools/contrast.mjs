// Planner-owned gate for run 2026-11-09-ui-v3: the DESIGN_SYSTEM_V3 §2.1 palette and its WCAG minimums. Exit 0 iff every pair passes.
const L = (hex) => { const c = hex.replace('#','').match(/../g).map(h => parseInt(h,16)/255).map(v => v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; };
const cr = (a,b) => { const [x,y]=[L(a),L(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
const themes = {
 // Primary = the Warsha logo yellow (#FFD400) as a FILL with dark ink on it (owner, 2026-11-09). Yellow is never text or
 // a thin indicator on the light theme (≈1.3:1); links, focus and selected indicators use primaryText (dark gold) there.
 light: { bg:'#F6F4EF', surface:'#FFFFFF', sunken:'#EFECE5', line:'#E2DDD3', lineStrong:'#8C877C', text:'#1B1A17', muted:'#5F5B53', faint:'#7A756B',
   primary:'#FFD400', primaryHover:'#F2C600', onPrimary:'#1B1A17', primarySoft:'#FFF4C2', primaryText:'#7A5C00',
   attention:'#A8430A', attentionSoft:'#FFEEDF', success:'#1B6B39', successSoft:'#E4F3E8', danger:'#A8261D', dangerSoft:'#FCE9E7', info:'#1F55A0', infoSoft:'#E7EFFA', focus:'#7A5C00' },
 dark: { bg:'#131210', surface:'#1B1A17', sunken:'#24221E', line:'#33302A', lineStrong:'#7D776C', text:'#F1EEE7', muted:'#B3AEA3', faint:'#948F84',
   primary:'#FFD400', primaryHover:'#FFE04A', onPrimary:'#1B1A17', primarySoft:'#3A3008', primaryText:'#FFD84D',
   attention:'#FF9D5C', attentionSoft:'#3D2314', success:'#5CC98A', successSoft:'#15301F', danger:'#F07A70', dangerSoft:'#3A1714', info:'#7DB0F5', infoSoft:'#152842', focus:'#FFD400' },
};
const pairs = [
 ['text','bg',4.5],['text','surface',4.5],['text','sunken',4.5],['muted','bg',4.5],['muted','surface',4.5],['muted','sunken',4.5],['faint','surface',3.0],
 ['onPrimary','primary',4.5],['onPrimary','primaryHover',4.5],['text','primarySoft',4.5],['primaryText','surface',4.5],['primaryText','bg',4.5],['primaryText','sunken',4.5],['primaryText','primarySoft',4.5],
 ['attention','attentionSoft',4.5],['attention','surface',4.5],['attention','bg',4.5],['success','successSoft',4.5],['danger','dangerSoft',4.5],['danger','surface',4.5],['info','infoSoft',4.5],
 ['lineStrong','surface',3.0],['lineStrong','bg',3.0],['focus','surface',3.0],['focus','bg',3.0]];
let bad=0;
for (const [t,tk] of Object.entries(themes)) { console.log('--',t); for (const [f,b,min] of pairs) { const v=cr(tk[f],tk[b]); const ok=v>=min; if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${f.padEnd(12)} on ${b.padEnd(13)} ${v.toFixed(2)} (min ${min})`); } }
// --check-css <tokens.css>: every palette value above must be declared in the implementation as --w-<name>: <hex>
// (both themes), so the shipped tokens cannot drift from the measured palette.
const ci = process.argv.indexOf('--check-css');
if (ci > 0) {
  const css = (await import('node:fs')).readFileSync(process.argv[ci + 1], 'utf8').toLowerCase().replace(/\s+/g, '');
  const cssName = { muted: 'text-muted', faint: 'text-faint' };
  for (const [t, tk] of Object.entries(themes)) for (const [k, hex] of Object.entries(tk)) {
    if (k === 'attentionMark') continue;
    const name = cssName[k] ?? k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    if (!css.includes(`--w-${name}:${hex.toLowerCase()}`)) { bad++; console.log(`FAIL css missing --w-${name}: ${hex} (${t})`); }
  }
  console.log('css checked', process.argv[ci + 1]);
}
console.log('fails', bad); process.exit(bad?1:0);
