create function public.current_profile_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.user_profiles where id=auth.uid() and is_active
$$;

do $$
declare t text;
begin
 foreach t in array array['user_profiles','suppliers','customers','salespeople','products','product_equivalences','purchase_batches','purchase_requests','purchase_entries','invoices','invoice_items','receiving_inspections','inspection_items','allocations','occurrences','audit_logs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy read_allowed on public.%I for select to authenticated using (%s)',t,
   case when t='user_profiles' then 'id=auth.uid() or (select public.current_profile_role())=''administrador'''
        when t='audit_logs' then '(select public.current_profile_role())=''administrador'''
        when t='purchase_entries' then '(select public.current_profile_role()) in (''comprador'',''administrador'')'
        else '(select public.current_profile_role()) is not null' end);
 end loop;
end $$;

create function public.record_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_logs(user_id,entity_type,entity_id,action,previous_data,new_data,reason)
 values ((select id from public.user_profiles where id=auth.uid()),tg_table_name,coalesce(new.id,old.id),tg_op,
 case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end,
 case when tg_table_name='purchase_entries' then to_jsonb(new)->>'reason'
      when tg_table_name='occurrences' then to_jsonb(new)->>'resolution_notes'
      when tg_table_name='inspection_items' then to_jsonb(new)->>'notes' end);
 return null;
end $$;
do $$
declare t text;
begin
 foreach t in array array['user_profiles','product_equivalences','purchase_batches','purchase_requests','purchase_entries','invoices','receiving_inspections','inspection_items','allocations','occurrences'] loop
  execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function public.record_audit()',t);
 end loop;
end $$;
revoke all on function public.record_audit() from public, anon, authenticated;
revoke all on function public.current_profile_role() from public, anon;
grant execute on function public.current_profile_role() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('nfe-xml','nfe-xml',false,10485760,array['application/xml','text/xml']);
create policy read_invoice_xml on storage.objects for select to authenticated
 using(bucket_id='nfe-xml' and (select public.current_profile_role()) is not null);
create policy insert_invoice_xml on storage.objects for insert to authenticated
 with check(bucket_id='nfe-xml' and (select public.current_profile_role()) in ('conferente','administrador')
 and name ~ '^[0-9]{44}[.]xml$');

create function public.finalize_inspection(target uuid) returns uuid language plpgsql security definer set search_path='' as $$
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
   where p.id=item.product_id and upper(btrim(p.unit))=upper(btrim(x.unit))
  ) then
   if item.product_id is not null then
    insert into public.occurrences(invoice_id,inspection_id,invoice_item_id,occurrence_type,received_product_id,description,created_by)
    values(invoice.id,target,item.invoice_item_id,'packaging',item.product_id,'Unidades incompatíveis para distribuição automática',auth.uid());
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
revoke all on function public.finalize_inspection(uuid) from public, anon;
grant execute on function public.finalize_inspection(uuid) to authenticated;

create view public.distribution_items with (security_invoker=true) as
 select i.invoice_id,a.inspection_id,a.purchase_request_id,a.customer_id,c.name as customer_name,
 a.product_id,p.name as product_name,a.allocated_quantity
 from public.allocations a join public.invoice_items i on i.id=a.invoice_item_id
 join public.customers c on c.id=a.customer_id join public.products p on p.id=a.product_id;
revoke all on public.distribution_items from public,anon,authenticated;
grant select on public.distribution_items to authenticated;
