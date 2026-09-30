const fs = require('fs');
const data = fs.readFileSync('book2.js','utf8').match(/CARPET_DATA\s*=\s*"([^"]+)"/)[1];
const SYMMETRIES = [
  (r,c)=>[r,c], (r,c)=>[c,14-r], (r,c)=>[14-r,14-c], (r,c)=>[14-c,r],
  (r,c)=>[r,14-c], (r,c)=>[14-r,c], (r,c)=>[c,r], (r,c)=>[14-c,14-r]
];
const rs=[],cs=[],child=[],sib=[];
let pos=0;
function b2(){
  const idx=rs.length;
  rs.push(parseInt(data[pos],16)); cs.push(parseInt(data[pos+1],16));
  const m=data.charCodeAt(pos+2)-65; pos+=3;
  const st=m&3; const hc=st===0||st===2; const hs=st===2||st===3;
  child.push(-1); sib.push(-1);
  if(hc) child[idx]=b2();
  if(hs) sib[idx]=b2();
  return idx;
}
b2();
function cn(r,c){ return String.fromCharCode(65+c)+(15-r); }
function parse(s){ const c=s.charCodeAt(0)-97; const row=parseInt(s.slice(1)); return {r:15-row,c}; }

// 沿前13手匹配到黑K9节点(G11)
const seq13 = "h8 i9 i7 g9 j7 k7 h9 h7 i8 k6 j8 k8 k9".split(' ').map(parse);
let k9node = -1;
for (let s=0; s<8; s++) {
  const sym = SYMMETRIES[s];
  let node=0, ok=true;
  for (let i=1; i<seq13.length; i++) {
    const t = sym(seq13[i].r, seq13[i].c);
    let next=-1, c=child[node];
    while(c>=0){ if(rs[c]===t[0]&&cs[c]===t[1]){next=c;break;} c=sib[c]; }
    if(next<0){ ok=false; break; }
    node=next;
  }
  if(ok) { k9node=node; break; }
}

// G11节点的子节点（白棋响应对称类代表），展开它们的完整对称类
console.log('黑K9节点(G11)的子节点（对称类代表）:');
const reps=[];
let c=child[k9node];
while(c>=0){ reps.push([rs[c],cs[c]]); c=sib[c]; }
reps.forEach(r=>console.log('  代表', cn(r[0],r[1]), '(', r[0],',',r[1],')'));

// 展开所有对称类，看覆盖哪些位置
const allCovered = new Set();
reps.forEach(([r,c])=>{
  SYMMETRIES.forEach(sym=>{
    const t=sym(r,c);
    allCovered.add(t[0]*15+t[1]);
  });
});
console.log('2个代表展开后覆盖位置数:', allCovered.size);

// 白H6 (9,7)，看它在8个对称下映射到哪些位置
const h6 = parse('h6');
console.log('白H6 (9,7) 在8个对称下映射:');
SYMMETRIES.forEach((sym,i)=>{
  const t=sym(h6.r,h6.c);
  console.log('  对称'+i+':', cn(t[0],t[1]), '(', t[0],',',t[1],')', allCovered.has(t[0]*15+t[1])?' ← 已覆盖':' ← 未覆盖');
});
