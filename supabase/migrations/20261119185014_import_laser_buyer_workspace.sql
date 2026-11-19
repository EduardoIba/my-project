alter table public.purchase_requests add column buyer_data jsonb not null default '{}';
alter table public.purchase_batches add column buyer_data jsonb not null default '{}';
create table public.buyer_workspace (
 singleton boolean primary key default true check(singleton),
 revision bigint not null default 0, settings jsonb not null default '{}'
);
insert into public.buyer_workspace default values;
alter table public.buyer_workspace enable row level security;
revoke all on public.buyer_workspace from public,anon,authenticated;

create function public.load_buyer_workspace() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.current_profile_role(),'') not in ('comprador','administrador') then
  raise exception 'Perfil sem permissão para Compras' using errcode='42501';
 end if;
 return (
  select jsonb_build_object('revision',w.revision,'data',w.settings || jsonb_build_object(
   'imports',coalesce((select jsonb_agg(b.buyer_data || jsonb_build_object('sequence',b.batch_sequence) order by b.batch_sequence desc)
                       from public.purchase_batches b where b.status='confirmed'),'[]'),
   'requests',coalesce((select jsonb_agg(r.buyer_data || jsonb_build_object('allocatedQty',r.allocated_quantity,'pendingQty',r.pending_quantity)
                         order by b.batch_sequence desc,r.customer_position,r.item_position)
                         from public.purchase_requests r join public.purchase_batches b on b.id=r.batch_id
                         where r.status<>'archived' and b.status='confirmed'),'[]')
  )) from public.buyer_workspace w
 );
end $$;

create function public.save_buyer_workspace(expected_revision bigint, payload jsonb, archive_requests uuid[] default '{}', archive_batches uuid[] default '{}', deactivate_sellers text[] default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
   dense_rank() over(partition by a.value->>'importId' order by first_customer)::integer
  from (
   select x.*,min(x.ordinality) over(partition by x.value->>'importId',x.value->>'client') first_customer
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
  for entry in select value from jsonb_array_elements(coalesce(row_data->'purchaseEntries',
   case when coalesce((row_data->>'purchasedQty')::numeric,0)>0 then jsonb_build_array(jsonb_build_object(
    'id','legacy-'||request_key::text,'quantity',row_data->'purchasedQty','unitCost',row_data->'unitCost','date',row_data->'purchaseDate',
    'purchasedAt',row_data->'purchasedAt')) else '[]'::jsonb end))
  loop
   entry_key := md5(entry->>'id')::uuid;
   insert into public.purchase_entries(id,purchase_request_id,supplier_id,product_id,quantity,unit_price,operation_type,
    operation_group_id,replaces_id,purchase_date,purchased_at,status,voided_at,reason,created_by)
   values(entry_key,request_key,supplier_key,product_key,(entry->>'quantity')::numeric,(entry->>'unitCost')::numeric,
    case when entry ? 'replaces' then 'correction' else 'purchase' end,nullif(entry->>'operationId','')::uuid,
    md5(entry->>'replaces')::uuid,nullif(entry->>'date','')::date,nullif(entry->>'purchasedAt','')::timestamptz,
    case when entry->>'voidedAt' is null then 'active' else 'voided' end,(entry->>'voidedAt')::timestamptz,entry->>'reason',auth.uid())
   on conflict(id) do update set status='voided',voided_at=excluded.voided_at,reason=excluded.reason
   where public.purchase_entries.purchase_request_id=request_key and public.purchase_entries.status='active' and excluded.status='voided';
  end loop;
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
revoke all on function public.load_buyer_workspace(),public.save_buyer_workspace(bigint,jsonb,uuid[],uuid[],text[]) from public,anon;
grant execute on function public.load_buyer_workspace(),public.save_buyer_workspace(bigint,jsonb,uuid[],uuid[],text[]) to authenticated;
