import test from 'node:test';
import assert from 'node:assert/strict';
import {DATA_KEY, BACKUP_KEY, RESET_BACKUP_KEY, PURCHASE_RESET_VERSION, loadDatabase} from './storage.js';
function memory(entries={}){const data=new Map(Object.entries(entries));return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
const old={suppliers:['Fornecedor próprio'],sellers:['Vendedor próprio'],whatsappRules:{aliases:'PRÓPRIO=Fornecedor próprio'},requests:[{id:'old',status:'Comprado',purchasedQty:10,unitCost:99,purchaseEntries:[{quantity:10,unitCost:99}]}],imports:[{id:'old-import'}],activeBatchId:'old-import',purchases:[{id:'purchase'}],generatedOrders:[{text:'old'}],orderHistory:[{id:'order'}],preferences:{theme:'light'}};
test('Limpeza autorizada zera solicitações, compras, lotes e pedidos após criar backup exato',()=>{
 const raw=JSON.stringify(old),storage=memory({[DATA_KEY]:raw});const clean=loadDatabase(storage,{});
 assert.equal(JSON.parse(storage.getItem(RESET_BACKUP_KEY)).originalRaw,raw);assert.deepEqual(JSON.parse(storage.getItem(RESET_BACKUP_KEY)).data,old);
 for(const field of ['requests','imports','purchases','generatedOrders','orderHistory'])assert.deepEqual(clean[field],[]);
 assert.equal(clean.activeBatchId,'');assert.equal(clean.purchaseResetVersion,PURCHASE_RESET_VERSION);
 for(const field of ['suppliers','sellers','whatsappRules','preferences'])assert.deepEqual(clean[field],old[field]);
 assert.deepEqual(JSON.parse(storage.getItem(DATA_KEY)),clean);
});
test('Após primeira limpeza, registros reais novos permanecem ao recarregar',()=>{
 const storage=memory({[DATA_KEY]:JSON.stringify(old)}),clean=loadDatabase(storage,{}),backup=storage.getItem(RESET_BACKUP_KEY);
 clean.requests.push({id:'real',status:'Pendente'});clean.imports.push({id:'new-batch'});storage.setItem(DATA_KEY,JSON.stringify(clean));
 assert.deepEqual(loadDatabase(storage,{}).requests,[{id:'real',status:'Pendente'}]);assert.equal(storage.getItem(RESET_BACKUP_KEY),backup);
});
test('Falha ao criar backup impede a limpeza e conserva base original',()=>{
 const raw=JSON.stringify(old),storage=memory({[DATA_KEY]:raw});storage.setItem=()=>{throw new Error('quota')};
 assert.throws(()=>loadDatabase(storage,{}),/quota/);assert.equal(storage.getItem(DATA_KEY),raw);
});
test('Falha ao gravar base limpa mantém original e backup verificado',()=>{
 const raw=JSON.stringify(old),storage=memory({[DATA_KEY]:raw}),write=storage.setItem;
 storage.setItem=(key,value)=>{if(key===DATA_KEY)throw new Error('quota');write(key,value)};
 assert.throws(()=>loadDatabase(storage,{}));assert.equal(storage.getItem(DATA_KEY),raw);assert.equal(JSON.parse(storage.getItem(RESET_BACKUP_KEY)).originalRaw,raw);
});
test('Backup anterior nunca é sobrescrito quando existe uma cópia diferente',()=>{
 const previous=JSON.stringify({originalRaw:'outro',data:{requests:[]}}),storage=memory({[DATA_KEY]:JSON.stringify(old),[RESET_BACKUP_KEY]:previous,[BACKUP_KEY]:'antigo'});
 const clean=loadDatabase(storage,{});assert.notEqual(clean.resetBackupKey,RESET_BACKUP_KEY);assert.equal(storage.getItem(RESET_BACKUP_KEY),previous);
 assert.deepEqual(JSON.parse(storage.getItem(clean.resetBackupKey)).data,old);assert.equal(storage.getItem(BACKUP_KEY),'antigo');
});
test('Dados corrompidos não são apagados e instalação nova começa vazia',()=>{
 const invalid=memory({[DATA_KEY]:'invalid json'});assert.throws(()=>loadDatabase(invalid,{}));assert.equal(invalid.getItem(DATA_KEY),'invalid json');
 const storage=memory(),clean=loadDatabase(storage,{sellers:['Luiz'],suppliers:['Master']});assert.deepEqual(clean.requests,[]);assert.deepEqual(clean.imports,[]);assert.equal(storage.getItem(RESET_BACKUP_KEY),null);
});
