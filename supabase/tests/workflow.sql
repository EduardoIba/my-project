begin;
do $$
declare
 actor uuid := gen_random_uuid();
 batch_a uuid := gen_random_uuid();
 batch_b uuid := gen_random_uuid();
 request_a uuid := gen_random_uuid();
 request_b uuid := gen_random_uuid();
 supplier_key uuid;
 note uuid;
 second_note uuid;
 item uuid;
 inspection uuid;
 snapshot jsonb;
 xml_template text := '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe%KEY%"><ide><nNF>123</nNF><serie>1</serie><dhEmi>2026-11-19T08:00:00-03:00</dhEmi></ide><emit><CNPJ>98765432000199</CNPJ></emit><dest><CNPJ>12345678000199</CNPJ></dest><det nItem="1"><prod><cProd>EXT</cProd><xProd>Produto teste</xProd><uCom>UN</uCom><qCom>20</qCom><vUnCom>1.42</vUnCom><vProd>28.40</vProd></prod></det></infNFe></NFe>';
 key_a text := '35261198765432000199550010000001231111111110';
 key_b text := '35261198765432000199550010000001232222222228';
begin
 if has_table_privilege('anon','public.invoices','select')
    or has_table_privilege('authenticated','public.allocations','insert')
    or has_column_privilege('authenticated','public.purchase_requests','buyer_data','select')
    or has_function_privilege('anon','public.finalize_inspection(uuid)','execute') then
  raise exception 'Grants excessivos';
 end if;
 begin
  perform public.load_buyer_workspace();
  raise exception 'Acesso sem perfil aceito';
 exception when insufficient_privilege then null;
 end;
 insert into auth.users(id,email) values(actor,'importlaser-test-'||actor||'@example.invalid');
 insert into public.user_profiles(id,full_name,role) values(actor,'Teste transacional','administrador');
 perform set_config('request.jwt.claim.sub',actor::text,true);
 snapshot := public.load_buyer_workspace();
 snapshot := public.save_buyer_workspace((snapshot->>'revision')::bigint,jsonb_build_object(
  'suppliers',jsonb_build_array('Fornecedor teste'),'sellers',jsonb_build_array('Vendedor teste'),
  'imports',jsonb_build_array(jsonb_build_object('id',batch_b,'sequence',2),jsonb_build_object('id',batch_a,'sequence',1)),
  'requests',jsonb_build_array(
   jsonb_build_object('id',request_b,'importId',batch_b,'client','Cliente B','seller','Vendedor teste','supplier','Fornecedor teste','sku','INT','quantity',5,'purchasedQty',0),
   jsonb_build_object('id',request_a,'importId',batch_a,'client','Cliente A','seller','Vendedor teste','supplier','Fornecedor teste','sku','INT','quantity',4,'purchasedQty',2,'unitCost',1.42,'purchaseDate','2026-11-19')
  )));
 if (select batch_sequence from public.purchase_batches where id=batch_a)<>1
    or (select batch_sequence from public.purchase_batches where id=batch_b)<>2 then
  raise exception 'A ordem inicial dos lotes foi alterada';
 end if;
 if (select sum(total_amount) from public.purchase_entries where purchase_request_id=request_a) is distinct from 2.84::numeric then
  raise exception 'Compra parcial incorreta';
 end if;
 begin
  perform public.save_buyer_workspace((snapshot->>'revision')::bigint-1,snapshot->'data');
  raise exception 'Revisão concorrente aceita';
 exception when serialization_failure then null;
 end;
 declare
  amended jsonb;
  corrected uuid := gen_random_uuid();
 begin
  select jsonb_agg(
   case when (x->>'id')::uuid=request_a then x || jsonb_build_object('purchaseEntries',jsonb_build_array(
    jsonb_build_object('id','legacy-'||request_a::text,'quantity',2,'unitCost',1.42,'date','2026-11-19',
     'voidedAt','2026-11-19T12:00:00Z','reason','Correção individual'),
    jsonb_build_object('id',corrected,'quantity',2,'unitCost',1.50,'date','2026-11-19','replaces','legacy-'||request_a::text)
   )) else x end
  ) into amended from jsonb_array_elements(snapshot->'data'->'requests') x;
  snapshot := public.save_buyer_workspace((snapshot->>'revision')::bigint,jsonb_set(snapshot->'data','{requests}',amended));
  if (select sum(total_amount) from public.purchase_entries where purchase_request_id=request_a and status='active') is distinct from 3::numeric
     or not exists(select 1 from public.purchase_entries where purchase_request_id=request_a and status='voided') then
   raise exception 'Correção sem preservação do lançamento original';
  end if;
 end;
 select id into strict supplier_key from public.suppliers where legal_name='Fornecedor teste';
 perform public.set_supplier_cnpj(supplier_key,'98765432000199');
 perform public.validate_equivalence(public.register_product('INT','Produto teste','UN'),supplier_key,'EXT','UN');
 note := public.import_invoice_xml(replace(xml_template,'%KEY%',key_a));
 begin
  perform public.import_invoice_xml(replace(xml_template,'%KEY%',key_a));
  raise exception 'Chave duplicada aceita';
 exception when unique_violation then null;
 end;
 if public.get_invoice_xml(note) is distinct from replace(xml_template,'%KEY%',key_a) then raise exception 'XML alterado'; end if;
 select id into strict item from public.invoice_items where invoice_id=note;
 inspection := public.save_inspection(note,(select jsonb_build_array(jsonb_build_object('id',id,'productId',product_id,'received',6)) from public.invoice_items where id=item),null,true);
 perform public.finalize_inspection(inspection);
 if (select allocated_quantity from public.purchase_requests where id=request_a) is distinct from 4::numeric or
    (select allocated_quantity from public.purchase_requests where id=request_b) is distinct from 2::numeric then
  raise exception 'Prioridade, limite físico ou idempotência incorretos';
 end if;
 second_note := public.import_invoice_xml(replace(xml_template,'%KEY%',key_b));
 perform public.save_inspection(second_note,(select jsonb_build_array(jsonb_build_object('id',id,'productId',product_id,'received',20)) from public.invoice_items where invoice_id=second_note),null,true);
 if (select sum(allocated_quantity) from public.distribution_items where invoice_id=second_note) is distinct from 3::numeric
    or (select pending_quantity from public.purchase_requests where id=request_b) is distinct from 0::numeric
    or not exists(select 1 from public.occurrences where invoice_id=note and occurrence_type='shortage') then
  raise exception 'Saldo entre notas, excesso de alocação ou divergência incorretos';
 end if;
 snapshot := public.save_buyer_workspace((snapshot->>'revision')::bigint,
  jsonb_set(snapshot->'data','{requests}','[]'));
 if not exists(select 1 from public.purchase_requests where id=request_a and status='open') then
  raise exception 'Omissão no payload arquivou uma solicitação';
 end if;
 snapshot := public.save_buyer_workspace((snapshot->>'revision')::bigint,snapshot->'data',array[request_a],array[batch_a]);
 if not exists(select 1 from public.purchase_requests where id=request_a and status='archived')
    or not exists(select 1 from public.purchase_entries where purchase_request_id=request_a)
    or not exists(select 1 from public.purchase_requests where id=request_b and status='open') then
  raise exception 'Arquivamento afetou registros além da seleção';
 end if;
 update public.user_profiles set role='comprador' where id=actor;
 begin
  perform public.finalize_inspection(inspection);
  raise exception 'Comprador conseguiu finalizar conferência';
 exception when insufficient_privilege then null;
 end;
 update public.user_profiles set is_active=false where id=actor;
 begin
  perform public.load_buyer_workspace();
  raise exception 'Perfil inativo conseguiu consultar Compras';
 exception when insufficient_privilege then null;
 end;
end $$;
rollback;
select 'workflow_ok' as result;
