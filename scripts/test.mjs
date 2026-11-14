import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
import {seed,act,metrics,planning,mrp,score,today,QUALITY_REASONS,CANCEL_REASONS} from '../worker/domain.mjs';
let s=seed('owner');assert.equal(s.items.length,25);assert.equal(s.items.filter(i=>i.bom.length).length,5);assert.equal(s.locations.length,3);assert.equal(s.suppliers.length,6);assert.equal(s.customers.length,10);assert.equal(new Set(s.sales.map(x=>x.date)).size,210);
const item=s.items[0],before=item.stock[0],m=metrics(s);
let sale=act(s,'sale',{location:0,lines:[{item:item.id,qty:2},{item:s.items[6].id,qty:1}],discount:2,tax:6},'owner');assert.equal(item.stock[0],before-2);assert.equal(sale.revenue,2*item.price+s.items[6].price-2);assert.ok(Math.abs(metrics(s).revenue-m.revenue-sale.revenue)<.0001);
act(s,'return',{sale:sale.id,item:item.id,qty:1,location:0,reason:'Changed mind'},'owner');assert.equal(item.stock[0],before-1);assert.throws(()=>act(s,'return',{sale:sale.id,item:item.id,qty:2,location:0,reason:'Changed mind'},'owner'),/exceeds/);
act(s,'return',{sale:sale.id,item:item.id,qty:1,location:0,reason:'Fabric defect',exchangeItem:s.items[1].id},'owner');assert.equal(s.returns[0].disposition,'Quarantine / quality hold');assert.equal(item.stock[0],before-1);assert.ok(s.returns[0].exchangeSale);
const component=s.items.find(x=>x.id===item.bom[0].item);component.stock[0]=500;
act(s,'production',{item:item.id,qty:10,location:0},'owner');let wo=s.production[0],cq=component.stock[0];act(s,'issue',{id:wo.id},'owner');assert.equal(component.stock[0],cq-10*item.bom[0].qty);assert.equal(wo.status,'In Progress');const oldstock=item.stock[0];act(s,'complete',{id:wo.id,good:8,scrap:2,rework:1,reason:'Seam failure'},'owner');assert.equal(item.stock[0],oldstock+8);assert.equal(wo.status,'Completed');assert.equal(wo.good+wo.scrap,wo.qty);assert.throws(()=>act(s,'issue',{id:wo.id},'owner'));
let raw=s.items[6];act(s,'po',{supplier:raw.supplier,location:1,lines:[{item:raw.id,qty:10}]},'owner');let po=s.pos[0],stock=raw.stock[1];act(s,'receive',{id:po.id,item:raw.id,qty:4,location:1},'owner');assert.equal(raw.stock[1],stock+4);assert.equal(po.status,'Order Sent');act(s,'receive',{id:po.id,item:raw.id,qty:6,location:1},'owner');assert.equal(po.status,'Received');assert.throws(()=>act(s,'receive',{id:po.id,item:raw.id,qty:1,location:1},'owner'));
act(s,'pay',{id:po.id,amount:po.lines[0].cost*10},'owner');assert.ok(Math.abs(po.paid-po.lines[0].cost*10)<.0001);act(s,'poClose',{id:po.id},'owner');assert.equal(po.status,'Closed');
let score1=score(s,s.suppliers.find(x=>x.id===raw.supplier));assert.ok(score1.onTime<=1&&score1.onTime>=0);assert.ok(score1.fill<=1&&score1.fill>=0);assert.equal(planning(s).length,25);assert.ok(mrp(s).length);
let beforeQ=raw.stock[0];act(s,'transfer',{item:raw.id,location:0,to:2,qty:1},'owner');assert.equal(raw.stock[0],beforeQ-1);
assert.throws(()=>act(s,'adjust',{item:raw.id,location:0,qty:-999999,reason:'Damage'},'owner'),/Insufficient/);
act(s,'order',{customer:'C1',location:0,required:today(),lines:[{item:raw.id,qty:1}]},'owner');let so=s.orders[0];act(s,'orderStatus',{id:so.id,status:'Fulfilled'},'owner');assert.equal(so.status,'Fulfilled');act(s,'orderStatus',{id:so.id,status:'Closed'},'owner');assert.equal(so.status,'Closed');
// Work orders: cancel, actual start/finish times, and per-issue quality reasons.
{const p=s.items[1],stockOf=x=>JSON.stringify(s.items.map(i=>i.stock)),comps=p.bom.map(b=>s.items.find(i=>i.id===b.item));for(const c of comps)c.stock[0]=1000;
 assert.deepEqual(QUALITY_REASONS,['Seam failure','Fabric defect','Cutting error','Machine issue']);assert.ok(!QUALITY_REASONS.includes('Rework completed'));
 // Cancel a planned order: nothing moves, reason is required and validated.
 act(s,'production',{item:p.id,qty:5,location:0},'owner');let planned=s.production[0],snap=stockOf();
 assert.throws(()=>act(s,'cancelProduction',{id:planned.id},'owner'),/cancellation reason/);assert.throws(()=>act(s,'cancelProduction',{id:planned.id,reason:'Because'},'owner'),/cancellation reason/);
 act(s,'cancelProduction',{id:planned.id,reason:'Entered by mistake'},'owner');assert.equal(planned.status,'Cancelled');assert.equal(planned.cancelReason,'Entered by mistake');assert.equal(planned.cancelledFrom,'Planned');assert.equal(stockOf(),snap);assert.equal(s.audit[0].action,'cancelProduction');assert.equal(s.audit[0].detail,'Entered by mistake');
 assert.throws(()=>act(s,'cancelProduction',{id:planned.id,reason:'Entered by mistake'},'owner'),/Only planned or in-progress/);assert.throws(()=>act(s,'issue',{id:planned.id},'owner'),/planned/);
 // Cancel an in-progress order: every issued component returns to the same location, value is preserved.
 act(s,'production',{item:p.id,qty:6,location:0},'owner');let wip=s.production[0];const pre=comps.map(c=>c.stock[0]),preCost=comps.map(c=>c.cost),preValue=metrics(s).value;act(s,'issue',{id:wip.id},'owner');assert.ok(metrics(s).wip>0);
 act(s,'cancelProduction',{id:wip.id,reason:'Order cancelled'},'owner');assert.deepEqual(comps.map(c=>c.stock[0]),pre);comps.forEach((c,k)=>assert.ok(Math.abs(c.cost-preCost[k])<1e-9));assert.ok(Math.abs(metrics(s).value-preValue)<1e-6);assert.equal(metrics(s).wip,0);assert.equal(wip.cancelledFrom,'In Progress');assert.match(s.audit[0].detail,/materials returned to Main Workshop/);
 // Completed orders cannot be cancelled.
 assert.throws(()=>act(s,'cancelProduction',{id:wo.id,reason:'Order cancelled'},'owner'),/Only planned or in-progress/);
 // Per-issue quality lines must add up, and each needs a valid reason.
 const fresh=q=>{act(s,'production',{item:p.id,qty:q,location:0},'owner');const o=s.production[0];act(s,'issue',{id:o.id},'owner');o.started=new Date(Date.now()-3*36e5).toISOString();return o};
 let q=fresh(10);const base={id:q.id,good:8,scrap:2,rework:1};
 assert.throws(()=>act(s,'complete',{...base,issues:[]},'owner'),/Scrap reasons must add up to 2/);
 assert.throws(()=>act(s,'complete',{...base,issues:[{type:'Scrap',qty:1,reason:'Seam failure'},{type:'Rework',qty:1,reason:'Cutting error'}]},'owner'),/Scrap reasons must add up to 2 scrapped units \(currently 1\)/);
 assert.throws(()=>act(s,'complete',{...base,issues:[{type:'Scrap',qty:2,reason:'Seam failure'}]},'owner'),/Rework reasons must add up to 1/);
 assert.throws(()=>act(s,'complete',{...base,issues:[{type:'Scrap',qty:2,reason:'Rework completed'},{type:'Rework',qty:1,reason:'Cutting error'}]},'owner'),/Choose a reason/);
 assert.throws(()=>act(s,'complete',{...base,issues:[{type:'Scrap',qty:2,reason:'Seam failure'},{type:'Oops',qty:1,reason:'Cutting error'}]},'owner'),/Scrap or Rework/);
 assert.equal(q.status,'In Progress');
 const good0=p.stock[0];act(s,'complete',{...base,issues:[{type:'Scrap',qty:1,reason:'Seam failure'},{type:'Scrap',qty:1,reason:'Fabric defect'},{type:'Rework',qty:1,reason:'Cutting error'}]},'owner');
 assert.equal(q.status,'Completed');assert.equal(p.stock[0],good0+8);assert.equal(q.issues.length,3);assert.equal(q.reason,'Scrap 1: Seam failure; Scrap 1: Fabric defect; Rework 1: Cutting error');assert.match(s.audit[0].detail,/Fabric defect/);assert.ok(!q.clockStarted,'Untouched times are not flagged as edited');
 // No problems → no lines needed.
 q=fresh(4);act(s,'complete',{id:q.id,good:4,scrap:0,rework:0,issues:[]},'owner');assert.equal(q.status,'Completed');assert.equal(q.reason,'');
 // Actual start/finish times: validated, stored, and the original click times kept for audit.
 q=fresh(5);const inv=(st,fin)=>({id:q.id,good:5,scrap:0,rework:0,issues:[],started:st,finished:fin}),h=n=>new Date(Date.now()+n*36e5).toISOString();
 assert.throws(()=>act(s,'complete',inv(h(-2),h(-3)),'owner'),/after start/);assert.throws(()=>act(s,'complete',inv(h(-2),h(-2)),'owner'),/after start/);
 assert.throws(()=>act(s,'complete',inv(h(-2),h(2)),'owner'),/future/);assert.throws(()=>act(s,'complete',inv(h(-24*31),h(-1)),'owner'),/30 days/);assert.throws(()=>act(s,'complete',inv('not a date',h(-1)),'owner'),/valid start/);
 const clicked=q.started,st=h(-6),fin=h(-1.5);act(s,'complete',inv(st,fin),'owner');assert.equal(q.started,st);assert.equal(q.finished,fin);assert.equal(q.clockStarted,clicked);assert.ok(q.clockFinished);assert.match(s.audit[0].detail,/Times entered .* \(clicked /);
 assert.ok(Math.abs((new Date(q.finished)-new Date(q.started))/36e5-4.5)<1e-9);
 // Leave one planned and one in-progress order so their screens render below.
 act(s,'production',{item:p.id,qty:3,location:0},'owner');act(s,'production',{item:p.id,qty:2,location:0},'owner');act(s,'issue',{id:s.production[0].id},'owner');}
// Render every screen and form using real state, then syntax-check every inline event handler.
const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',value:'',textContent:'',focus(){}});return nodes.get(id)};
const doc={getElementById:node,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},createElement:()=>({click(){}})};
const context=vm.createContext({document:doc,console,Intl,Date,Number,String,Array,Object,Set,Math,JSON,Blob,URL,setTimeout(){},setInterval(){},fetch:()=>new Promise(()=>{}),window:{print(){}},FormData:class{}});
const script=fs.readFileSync('worker/index.html','utf8').split('<script>')[1].split('</script>')[0];vm.runInContext(script,context);
context.data={state:s,revision:1,user:{id:'owner',role:'owner',email:'owner@example.com'},metrics:metrics(s),planning:planning(s),mrp:mrp(s),scores:s.suppliers.map(x=>({id:x.id,...score(s,x)}))};
vm.runInContext('D=data;S=data.state;U=data.user;',context);
let rendered=0;function validate(html){assert.ok(html&&!html.includes('undefined'),'No undefined render values');for(const m of html.matchAll(/on(?:click|change|input|keydown|submit)="([^"]*)"/g)){const handler=m[1].replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>');new Function('event',handler)}rendered++;}
for(const name of ['overview','pos','inventory','orders','returns','production','purchasing','suppliers','mrp','financials','reports','portal','settings'])validate(vm.runInContext(name+'()',context));
for(const kind of ['order','transfer','adjust','production','return','po','supplier','import']){vm.runInContext("openModal('"+kind+"')",context);validate(node('modal').innerHTML)}
for(const [kind,id]of [['complete',wo.id],['receive',po.id],['pay',po.id],['supplier',s.suppliers[0].id]]){vm.runInContext("openModal("+JSON.stringify(kind)+","+JSON.stringify(id)+")",context);validate(node('modal').innerHTML)}
// New work order screens: cancel (planned + in progress), complete with times and quality lines, material check (ready + short), transfer/PO shortcuts.
{const inprog=s.production.find(x=>x.status==='In Progress'),plan=s.production.find(x=>x.status==='Planned'),cancelled=s.production.find(x=>x.status==='Cancelled');assert.ok(inprog&&plan&&cancelled);
 const prod=vm.runInContext('production()',context).replaceAll('&#39;',"'").replaceAll('&quot;','"');validate(prod);assert.ok(prod.includes("openModal('cancelProduction','"+plan.id+"')"));assert.ok(prod.includes("openModal('cancelProduction','"+inprog.id+"')"));assert.ok(prod.includes('opacity:.5'));assert.ok(prod.includes('✎'));
 for(const id of [plan.id,inprog.id]){vm.runInContext("openModal('cancelProduction',"+JSON.stringify(id)+")",context);const h=node('modal').innerHTML;validate(h);assert.ok(h.includes('Keep work order')&&h.includes('Entered by mistake'))}
 assert.ok(node('modal').innerHTML.includes('Quantity returned'));
 vm.runInContext("openModal('complete',"+JSON.stringify(inprog.id)+")",context);let h=node('modal').innerHTML;validate(h);assert.ok(h.includes('datetime-local')&&h.includes('Production time')&&h.includes('Quality issues')&&!h.includes('Rework completed'));
 vm.runInContext("qIssues=[{type:'Scrap',qty:1,reason:'Seam failure'},{type:'Rework',qty:1,reason:''}]",context);const q=vm.runInContext('qualityUI()',context);validate(q);assert.ok(q.includes('Choose reason'));
 assert.equal(vm.runInContext("durationText('2026-01-01T08:00','2026-01-01T12:30')",context),'Production time: 4.5 hours');assert.match(vm.runInContext("durationText('2026-01-01T08:00','2026-01-01T07:00')",context),/after the start/);
 const tote=s.items[0],canvas=s.items.find(x=>x.id===tote.bom[0].item);canvas.stock=[14,18,0];
 const short=vm.runInContext("matCheck('"+tote.id+"',0,10)",context);validate(short);assert.ok(short.includes('Not enough materials')&&short.includes('Short 6')&&short.includes('You can make up to 7')&&short.includes('Transfer 6 from North Warehouse')&&short.includes('Create PO'));
 const ok=vm.runInContext("matCheck('"+tote.id+"',0,3)",context);validate(ok);assert.ok(ok.includes('All materials are available'));
 assert.ok(vm.runInContext("matCheck('"+tote.id+"',2,5)",context).includes('No other location')===false);
 vm.runInContext("openModal('production')",context);validate(node('modal').innerHTML);assert.ok(node('modal').innerHTML.includes('id="matcheck"'));
 vm.runInContext("woDraft={item:'"+tote.id+"',location:0,qty:10};openModal('transfer')",context);validate(node('modal').innerHTML);assert.ok(node('modal').innerHTML.includes('go straight back to your work order'));
 vm.runInContext("woDraft={item:'"+tote.id+"',location:0,qty:10};openModal('production')",context);validate(node('modal').innerHTML);assert.equal(vm.runInContext('woDraft',context),null);
 vm.runInContext("poForWO('"+canvas.id+"',6,0)",context);h=node('modal').innerHTML;validate(h);assert.ok(h.includes('Pre-filled from the work order')&&h.includes('6 × '+canvas.name));assert.equal(vm.runInContext('cart[0].qty',context),6);assert.equal(vm.runInContext('poSupplier',context),canvas.supplier);}
vm.runInContext("tab='Barcode labels';",context);validate(vm.runInContext('inventory()',context));
console.log('PASS: seed counts, 210-day history, sale, discount, tax, returns, exchange, manufacturing, scrap, work order cancel (planned + in progress), actual start/finish times, per-issue quality reasons, material check, partial PO receipts, payment, status transitions, planning, stock validation, '+rendered+' screen/form renders, inline handlers.');
// Server authorization, isolated failed transactions, and optimistic conflict protection.
await import('./build.mjs');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('worker/index.js')).toString('base64'))).default;
let row=null;
const DB={prepare(sql){let args;return {bind(...a){args=a;return this},async first(){return row?structuredClone(row):null},async run(){if(sql.startsWith('INSERT')){if(!row)row={id:1,revision:0,data:args[0]};return {meta:{changes:1}}}if(sql.startsWith('UPDATE')){if(row.revision!==args[1])return {meta:{changes:0}};row.data=args[0];row.revision++;return {meta:{changes:1}}}throw Error('Unexpected SQL')}}}};
const req=async(path,who='',body)=>{let headers={'oai-authenticated-user-id':who,'oai-authenticated-user-email':who.includes('@')?who:who+'@example.com'};if(body){headers['Content-Type']='application/json';headers.origin='https://erp.example'}let r=await worker.fetch(new Request('https://erp.example'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}),{DB});return {status:r.status,body:await r.json()}};
assert.equal((await req('/api/state')).status,401);
let owner=await req('/api/state','owner');assert.equal(owner.body.user.role,'owner');
let c=await req('/api/state','alice');assert.equal(c.body.user.role,'customer');assert.ok(!('suppliers' in c.body.state));assert.ok(!('cost' in c.body.state.items[0]));assert.equal(c.body.state.orders.length,0);
let denied=await req('/api/action','alice',{revision:0,action:'sale',payload:{}});assert.equal(denied.status,403);
let good=await req('/api/action','owner',{revision:0,action:'sale',payload:{location:0,lines:[{item:'TM-001',qty:1}],discount:0,tax:6}});assert.equal(good.status,200);assert.equal(row.revision,1);
let stale=await req('/api/action','owner',{revision:0,action:'sale',payload:{}});assert.equal(stale.status,409);
let snap=row.data,failed=await req('/api/action','owner',{revision:1,action:'sale',payload:{location:0,lines:[{item:'TM-001',qty:1},{item:'TM-006',qty:999999}]}});assert.equal(failed.status,400);assert.equal(row.data,snap);
let orderResult=await req('/api/action','alice',{revision:1,action:'order',payload:{location:0,required:today(),lines:[{item:'TM-001',qty:1}]}});assert.equal(orderResult.status,200);let own=await req('/api/state','alice'),other=await req('/api/state','bob');assert.equal(own.body.state.orders.length,1);assert.equal(other.body.state.orders.length,0);
console.log('PASS: API sign-in, customer data isolation, server role authorization, customer order ownership, shared revision conflicts, atomic rollback on stock failure.');

for(const email of ['rhong17@byu.edu','sdunn19@byu.edu']){
const team=await req('/api/state',email);assert.equal(team.body.user.role,'staff');assert.ok(team.body.state.suppliers.length);assert.ok(team.body.metrics);
assert.equal((await req('/api/action',email,{revision:row.revision,action:'user',payload:{email:'test@example.com',role:'staff'}})).status,403);
}
const teammateSale=await req('/api/action','rhong17@byu.edu',{revision:row.revision,action:'sale',payload:{location:0,lines:[{item:'TM-001',qty:1}],tax:6}});
assert.equal(teammateSale.status,200);
const shared=await req('/api/state','sdunn19@byu.edu');assert.ok(shared.body.state.sales.some(x=>x.id===teammateSale.body.result.id));
assert.equal((await req('/api/state','unlisted')).body.user.role,'customer');
console.log('PASS: approved teammate accounts get main ERP, can post shared transactions, retain owner-only access restrictions; unlisted accounts remain customers.');
