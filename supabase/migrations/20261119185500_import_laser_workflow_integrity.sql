create or replace function public.save_buyer_workspace(expected_revision bigint, payload jsonb, archive_requests uuid[] default '{}', archive_batches uuid[] default '{}', deactivate_sellers text[] default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare
 rev bigint;
 batch jsonb;
 row_data jsonb;
 entry jsonb;
 batch_key uuid;
 request_key uuid;
 supplier_key uuid;
 customer_key uuid;
 salesperson_key uuid;
 product_key uuid;
 entry_key uuid;
 existing_entry public.purchase_entries;
 expected_entries integer;
 seen_entries uuid[];
 item_rank integer;
 customer_rank integer;
begin
 if coalesce(public.current_profile_role(),'') not in ('comprador','administrador') then
  raise exception 'Perfil sem permissão para Compras' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(674901);
 select revision into rev from public.buyer_workspace for update;
 if expected_revision is distinct from rev then
  raise exception 'Compras foram alteradas em outra sessão. Recarregue a página antes de salvar.' using errcode='40001';
 end if;
 if jsonb_typeof(payload->'requests') is distinct from 'array' or jsonb_typeof(payload->'imports') is distinct from 'array' then
  raise exception 'Dados de Compras inválidos';
 end if;
 insert into public.suppliers(legal_name)
 select value from jsonb_array_elements_text(payload->'suppliers') where nullif(btrim(value),'') is not null
 on conflict(legal_name) do nothing;
 insert into public.salespeople(name)
 select value from jsonb_array_elements_text(payload->'sellers') where nullif(btrim(value),'') is not null
 on conflict(name) do update set is_active=true where not public.salespeople.is_active;
 update public.salespeople s set is_active=false,updated_at=now()
 where s.is_active and s.name=any(deactivate_sellers);
 for batch in select value from jsonb_array_elements(payload->'imports') order by (value->>'sequence')::bigint loop
  batch_key := (batch->>'id')::uuid;
  if not exists(select 1 from public.purchase_batches where id=batch_key) then
   insert into public.purchase_batches(id,original_message,confirmed_by,buyer_data)
   values(batch_key,coalesce(batch->>'originalMessage',''),auth.uid(),batch);
  end if;
 end loop;
 for row_data,item_rank,customer_rank in
  select a.value, row_number() over(partition by a.value->>'importId' order by a.ordinality)::integer,
   sum(case when a.value->>'client' is distinct from previous_customer then 1 else 0 end)
    over(partition by a.value->>'importId' order by a.ordinality)::integer
  from (
   select x.*,lag(x.value->>'client') over(partition by x.value->>'importId' order by x.ordinality) previous_customer
   from jsonb_array_elements(payload->'requests') with ordinality x
  ) a order by a.ordinality
 loop
  row_data := row_data - 'allocatedQty' - 'pendingQty';
  request_key := (row_data->>'id')::uuid;
  if exists(select 1 from public.purchase_requests where id=request_key and buyer_data=row_data and status<>'archived') then
   continue;
  end if;
  batch_key := (row_data->>'importId')::uuid;
  select id into supplier_key from public.suppliers where legal_name=row_data->>'supplier';
  select id into salesperson_key from public.salespeople where name=row_data->>'seller';
  select id into customer_key from public.customers where name=row_data->>'client' order by id limit 1;
  if customer_key is null then
   insert into public.customers(name) values(nullif(btrim(row_data->>'client'),'')) returning id into customer_key;
  end if;
  select id into product_key from public.products where is_active and internal_code=row_data->>'sku';
  insert into public.purchase_requests(id,batch_id,supplier_id,customer_id,salesperson_id,product_id,original_product_description,
   requested_quantity,customer_position,item_position,original_line,status,buyer_data)
  values(request_key,batch_key,supplier_key,customer_key,salesperson_key,product_key,row_data->>'sku',(row_data->>'quantity')::numeric,
   customer_rank,item_rank,row_data->>'originalLine',case when row_data->>'status'='Cancelado' then 'cancelled' else 'open' end,row_data)
  on conflict(id) do update set supplier_id=excluded.supplier_id,customer_id=excluded.customer_id,salesperson_id=excluded.salesperson_id,
   product_id=excluded.product_id,requested_quantity=excluded.requested_quantity,status=excluded.status,buyer_data=excluded.buyer_data,updated_at=now()
  where public.purchase_requests.batch_id=excluded.batch_id and public.purchase_requests.status<>'archived'
  and (public.purchase_requests.allocated_quantity=0 or (
   public.purchase_requests.product_id is not distinct from excluded.product_id
   and public.purchase_requests.supplier_id is not distinct from excluded.supplier_id
   and public.purchase_requests.customer_id=excluded.customer_id));
  if not found then raise exception 'Não é possível alterar a origem ou o vínculo de uma solicitação distribuída'; end if;
  seen_entries := '{}';
  for entry in select value from jsonb_array_elements(coalesce(row_data->'purchaseEntries',
   case when coalesce((row_data->>'purchasedQty')::numeric,0)>0 then jsonb_build_array(jsonb_build_object(
    'id','legacy-'||request_key::text,'quantity',row_data->'purchasedQty','unitCost',row_data->'unitCost','date',row_data->'purchaseDate',
    'purchasedAt',row_data->'purchasedAt')) else '[]'::jsonb end))
  loop
   entry_key := md5(entry->>'id')::uuid;
   if entry_key is null or entry_key=any(seen_entries) then raise exception 'Lançamentos duplicados ou sem ID'; end if;
   seen_entries := array_append(seen_entries,entry_key);
   select * into existing_entry from public.purchase_entries where id=entry_key;
   if found then
    if existing_entry.purchase_request_id<>request_key
     or existing_entry.quantity is distinct from (entry->>'quantity')::numeric
     or existing_entry.unit_price is distinct from (entry->>'unitCost')::numeric(18,6)
     or existing_entry.purchase_date is distinct from nullif(entry->>'date','')::date
     or existing_entry.purchased_at is distinct from nullif(entry->>'purchasedAt','')::timestamptz
     or existing_entry.operation_group_id is distinct from nullif(entry->>'operationId','')::uuid
     or existing_entry.replaces_id is distinct from md5(entry->>'replaces')::uuid
     or (existing_entry.voided_at is not null and existing_entry.voided_at is distinct from (entry->>'voidedAt')::timestamptz) then
     raise exception 'Corrija lançamentos preservando a versão anterior';
    end if;
    if existing_entry.status='active' and entry->>'voidedAt' is not null then
     update public.purchase_entries set status='voided',voided_at=(entry->>'voidedAt')::timestamptz,reason=entry->>'reason'
     where id=entry_key;
    end if;
    continue;
   end if;
   if entry ? 'replaces' and not exists(
    select 1 from public.purchase_entries where id=md5(entry->>'replaces')::uuid and purchase_request_id=request_key and status='voided'
   ) then raise exception 'Lançamento anterior da correção inválido'; end if;
   insert into public.purchase_entries(id,purchase_request_id,supplier_id,product_id,quantity,unit_price,operation_type,
    operation_group_id,replaces_id,purchase_date,purchased_at,status,voided_at,reason,created_by)
   values(entry_key,request_key,supplier_key,product_key,(entry->>'quantity')::numeric,(entry->>'unitCost')::numeric,
    case when entry ? 'replaces' then 'correction' else 'purchase' end,nullif(entry->>'operationId','')::uuid,
    md5(entry->>'replaces')::uuid,nullif(entry->>'date','')::date,nullif(entry->>'purchasedAt','')::timestamptz,
    case when entry->>'voidedAt' is null then 'active' else 'voided' end,(entry->>'voidedAt')::timestamptz,entry->>'reason',auth.uid());
  end loop;
  select count(*) into expected_entries from public.purchase_entries where purchase_request_id=request_key;
  if expected_entries<>cardinality(seen_entries) then raise exception 'O histórico de Compras precisa ser preservado'; end if;
  if (select coalesce(sum(quantity),0) from public.purchase_entries where purchase_request_id=request_key and status='active') >
     (row_data->>'quantity')::numeric then raise exception 'Compras excedem a quantidade solicitada'; end if;
 end loop;
 update public.purchase_requests r set status='archived',updated_at=now() where r.id=any(archive_requests) and r.status<>'archived';
 if exists(select 1 from public.purchase_requests where batch_id=any(archive_batches) and status<>'archived') then
  raise exception 'O lote ainda contém solicitações ativas';
 end if;
 update public.purchase_batches b set status='archived',updated_at=now() where b.id=any(archive_batches) and b.status='confirmed';
 update public.buyer_workspace set revision=rev+1,settings=payload-'requests'-'imports';
 return public.load_buyer_workspace();
end $$;

create or replace function public.import_invoice_xml(source text) returns uuid language plpgsql security definer set search_path='' as $$
declare
 doc xml;
 header record;
 line record;
 supplier_key uuid;
 invoice_key uuid;
 key_text text;
 digit integer;
begin
 if coalesce(public.current_profile_role(),'') not in ('conferente','administrador') then
  raise exception 'Perfil sem permissão' using errcode='42501';
 end if;
 if octet_length(source)>10485760 or source ~* '<![[:space:]]*(doctype|entity)' then
  raise exception 'XML acima do limite ou com declaração de entidade';
 end if;
 doc := xmlparse(document source);
 select * into strict header from xmltable(xmlnamespaces('http://www.portalfiscal.inf.br/nfe' as n),
  '/n:nfeProc/n:NFe/n:infNFe | /n:NFe/n:infNFe' passing doc columns
  id text path '@Id', number text path 'n:ide/n:nNF', series text path 'n:ide/n:serie',
  issuer text path 'n:emit/n:CNPJ', recipient text path 'n:dest/n:CNPJ',
  issued text path 'n:ide/n:dhEmi');
 if header.id is null or header.id !~ '^NFe[0-9]{44}$' then raise exception 'Chave de acesso inválida'; end if;
 key_text := substring(header.id from 4);
 select (11 - sum(substring(key_text from n for 1)::integer * (2 + (43-n)%8)) % 11)::integer
 into digit from generate_series(1,43) n;
 if digit>=10 then digit := 0; end if;
 if right(key_text,1)::integer<>digit then raise exception 'Dígito verificador da chave inválido'; end if;
 if substring(key_text from 7 for 14) is distinct from header.issuer then raise exception 'CNPJ do emitente diverge da chave'; end if;
 if nullif(header.number,'') is null or nullif(header.series,'') is null then raise exception 'Número ou série ausente'; end if;
 select id into strict supplier_key from public.suppliers where cnpj=header.issuer and is_active;
 insert into public.invoices(access_key,invoice_number,series,supplier_id,issuer_cnpj,recipient_cnpj,issued_at,
  xml_storage_path,xml_import_method,validation_status)
 values(key_text,header.number,header.series,supplier_key,header.issuer,header.recipient,header.issued::timestamptz,
  key_text||'.xml','upload','validated') returning id into invoice_key;
 for line in select * from xmltable(xmlnamespaces('http://www.portalfiscal.inf.br/nfe' as n),
  '/n:nfeProc/n:NFe/n:infNFe/n:det | /n:NFe/n:infNFe/n:det' passing doc columns
  item integer path '@nItem', code text path 'n:prod/n:cProd', description text path 'n:prod/n:xProd',
  gtin text path 'n:prod/n:cEAN', unit text path 'n:prod/n:uCom', quantity numeric path 'n:prod/n:qCom',
  price numeric path 'n:prod/n:vUnCom', amount numeric path 'n:prod/n:vProd')
 loop
  insert into public.invoice_items(invoice_id,item_number,supplier_product_code,description,gtin,unit,invoiced_quantity,unit_price,total_amount,
   product_id,matching_status)
  select invoice_key,line.item,line.code,line.description,line.gtin,line.unit,line.quantity,line.price,line.amount,p.id,
   case when p.id is null then 'unmatched' else 'matched' end
  from (select 1) seed left join lateral (
   select pr.id from public.product_equivalences e join public.products pr on pr.id=e.product_id
   where e.supplier_id=supplier_key and e.supplier_product_code=line.code and e.source_unit=line.unit
   and e.validation_status='validated' and e.conversion_factor=1 and pr.is_active
   and upper(btrim(pr.unit))=upper(btrim(line.unit))
   and (e.gtin is null or e.gtin=line.gtin)
  ) p on true;
 end loop;
 if not found then raise exception 'NF-e sem itens'; end if;
 insert into public.invoice_xml_sources(invoice_id,source) values(invoice_key,source);
 return invoice_key;
end $$;


create or replace function public.save_inspection(note_id uuid, items jsonb, comments text default null, complete boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare
 target public.receiving_inspections;
 entry jsonb;
 original public.invoice_items;
 product_key uuid;
begin
 if coalesce(public.current_profile_role(),'') not in ('conferente','administrador') then
  raise exception 'Perfil sem permissão' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(674901);
 if jsonb_typeof(items) is distinct from 'array' then raise exception 'Itens inválidos'; end if;
 insert into public.receiving_inspections(invoice_id,inspector_id,notes)
 values(note_id,auth.uid(),comments) on conflict(invoice_id) do nothing;
 select * into strict target from public.receiving_inspections where invoice_id=note_id for update;
 if target.inspector_id<>auth.uid() and public.current_profile_role()<>'administrador' then
  raise exception 'Conferência atribuída a outro usuário' using errcode='42501';
 end if;
 if target.status='completed' then
  if complete then return target.id; end if;
  raise exception 'Conferência já finalizada';
 end if;
 update public.receiving_inspections set notes=comments,updated_at=now() where id=target.id;
 for entry in select value from jsonb_array_elements(items) loop
  select * into strict original from public.invoice_items where invoice_id=note_id and id=(entry->>'id')::uuid;
  product_key := nullif(entry->>'productId','')::uuid;
  insert into public.inspection_items(inspection_id,invoice_id,invoice_item_id,product_id,invoiced_quantity,received_quantity,matching_status,notes)
  values(target.id,note_id,original.id,product_key,original.invoiced_quantity,(entry->>'received')::numeric,
   case when product_key is null then 'unmatched' when product_key=original.product_id then 'matched' else 'substitution' end,entry->>'notes')
  on conflict(inspection_id,invoice_item_id) do update set product_id=excluded.product_id,received_quantity=excluded.received_quantity,
   matching_status=excluded.matching_status,notes=excluded.notes,updated_at=now();
 end loop;
 if complete then perform public.finalize_inspection(target.id); end if;
 return target.id;
end $$;


create or replace function public.finalize_inspection(target uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare
 inspection public.receiving_inspections;
 invoice public.invoices;
 item record;
 demand record;
 available numeric;
 amount numeric;
begin
 if coalesce(public.current_profile_role(),'') not in ('conferente','administrador') then
  raise exception 'Perfil sem permissão' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(674901);
 select * into strict inspection from public.receiving_inspections where id=target for update;
 if inspection.inspector_id<>auth.uid() and public.current_profile_role()<>'administrador' then
  raise exception 'Conferência atribuída a outro usuário' using errcode='42501';
 end if;
 if inspection.status='completed' then return target; end if;
 select * into strict invoice from public.invoices where id=inspection.invoice_id for update;
 if invoice.validation_status<>'validated' then raise exception 'NF-e aguardando validação'; end if;
 if not exists(select 1 from public.invoice_items where invoice_id=invoice.id) or exists(
  select 1 from public.invoice_items x where x.invoice_id=invoice.id and not exists(
   select 1 from public.inspection_items y where y.inspection_id=target and y.invoice_item_id=x.id
  )
 ) then raise exception 'Confirme todos os itens da NF-e'; end if;
 for item in
  select i.*, x.product_id as expected_product_id, x.invoiced_quantity as original_quantity
  from public.inspection_items i join public.invoice_items x on x.id=i.invoice_item_id
  where i.inspection_id=target order by x.item_number
 loop
  insert into public.occurrences(invoice_id,inspection_id,invoice_item_id,occurrence_type,expected_product_id,received_product_id,
   expected_quantity,received_quantity,description,created_by)
  select invoice.id,target,item.invoice_item_id,issue.kind,item.expected_product_id,item.product_id,
   item.original_quantity,item.received_quantity,issue.description,auth.uid()
  from (values
   ('shortage','Falta física',item.received_quantity<item.original_quantity),
   ('excess','Excedente físico',item.received_quantity>item.original_quantity),
   ('unknown_product','Produto desconhecido',item.matching_status='unmatched'),
   ('substitution',coalesce(item.notes,'Substituição'),item.matching_status='substitution')
  ) issue(kind,description,applies) where issue.applies;
  -- Conferência usa a unidade original do XML. Só distribui na mesma unidade do catálogo.
  if item.product_id is null or not exists(
   select 1 from public.products p join public.invoice_items x on x.id=item.invoice_item_id
   where p.id=item.product_id and p.is_active and coalesce(p.package_quantity,1)=1 and upper(btrim(p.unit))=upper(btrim(x.unit))
  ) then
   if item.product_id is not null then
    insert into public.occurrences(invoice_id,inspection_id,invoice_item_id,occurrence_type,received_product_id,description,created_by)
    values(invoice.id,target,item.invoice_item_id,'packaging',item.product_id,'Unidade ou embalagem sem equivalência segura para distribuição automática',auth.uid());
   end if;
   continue;
  end if;
  available := item.received_quantity;
  for demand in
   select r.id,r.customer_id,r.pending_quantity from public.purchase_requests r join public.purchase_batches b on b.id=r.batch_id
   where r.status='open' and b.status='confirmed' and r.product_id=item.product_id and r.supplier_id=invoice.supplier_id and r.pending_quantity>0
   order by b.batch_sequence,r.customer_position,r.item_position for update of r
  loop
   exit when available<=0;
   amount := least(available,demand.pending_quantity);
   insert into public.allocations(inspection_id,inspection_item_id,invoice_item_id,purchase_request_id,customer_id,product_id,allocated_quantity,created_by)
   values(target,item.id,item.invoice_item_id,demand.id,demand.customer_id,item.product_id,amount,auth.uid());
   update public.purchase_requests set allocated_quantity=allocated_quantity+amount,updated_at=now() where id=demand.id;
   available := available-amount;
  end loop;
 end loop;
 update public.receiving_inspections set status='completed',completed_at=now(),updated_at=now() where id=target;
 update public.invoices set status='received',updated_at=now() where id=invoice.id;
 return target;
end $$;
