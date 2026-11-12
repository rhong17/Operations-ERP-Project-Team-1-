import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
import {seed,act,metrics,planning,mrp,score,today} from '../worker/domain.mjs';
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
vm.runInContext("tab='Barcode labels';",context);validate(vm.runInContext('inventory()',context));
console.log('PASS: seed counts, 210-day history, sale, discount, tax, returns, exchange, manufacturing, scrap, partial PO receipts, payment, status transitions, planning, stock validation, '+rendered+' screen/form renders, inline handlers.');
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
