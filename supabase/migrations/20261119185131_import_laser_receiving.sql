create table public.invoice_xml_sources (
 invoice_id uuid primary key references public.invoices, source text not null
);
alter table public.invoice_xml_sources enable row level security;
revoke all on public.invoice_xml_sources from public,anon,authenticated;

create function public.get_invoice_xml(note_id uuid) returns text language plpgsql security definer set search_path='' as $$
begin
 if public.current_profile_role() is null then raise exception 'Perfil sem permissão' using errcode='42501'; end if;
 return (select source from public.invoice_xml_sources where invoice_id=note_id);
end $$;
revoke all on function public.get_invoice_xml(uuid) from public,anon;
grant execute on function public.get_invoice_xml(uuid) to authenticated;

create function public.set_supplier_cnpj(target uuid, document text) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.current_profile_role() is distinct from 'administrador' then raise exception 'Perfil sem permissão' using errcode='42501'; end if;
 update public.suppliers set cnpj=document,updated_at=now() where id=target;
end $$;

create function public.register_product(code text, description text, stock_unit text) returns uuid language plpgsql security definer set search_path='' as $$
declare product_key uuid;
begin
 if public.current_profile_role() is distinct from 'administrador' then raise exception 'Perfil sem permissão' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(674901);
 insert into public.products(internal_code,name,unit)
 values(nullif(btrim(code),''),nullif(btrim(description),''),nullif(btrim(stock_unit),'')) returning id into product_key;
 update public.purchase_requests set product_id=product_key,updated_at=now()
 where product_id is null and status='open' and buyer_data->>'sku'=btrim(code);
 return product_key;
end $$;

create function public.validate_equivalence(product uuid, supplier uuid, external_code text, external_unit text) returns uuid
 language plpgsql security definer set search_path='' as $$
declare equivalence uuid;
begin
 if public.current_profile_role() is distinct from 'administrador' then raise exception 'Perfil sem permissão' using errcode='42501'; end if;
 if not exists(select 1 from public.products p where p.id=product and p.is_active and upper(btrim(p.unit))=upper(btrim(external_unit))) then
  raise exception 'A unidade externa deve ser igual à do produto';
 end if;
 insert into public.product_equivalences(product_id,supplier_id,supplier_product_code,source_unit,conversion_factor,validation_status,validated_by,validated_at)
 values(product,supplier,nullif(btrim(external_code),''),nullif(btrim(external_unit),''),1,'validated',auth.uid(),now())
 returning id into equivalence;
 return equivalence;
end $$;
revoke all on function public.set_supplier_cnpj(uuid,text),public.register_product(text,text,text),public.validate_equivalence(uuid,uuid,text,text) from public,anon;
grant execute on function public.set_supplier_cnpj(uuid,text),public.register_product(text,text,text),public.validate_equivalence(uuid,uuid,text,text) to authenticated;
create trigger audit_supplier after insert or update or delete on public.suppliers for each row execute function public.record_audit();
create trigger audit_product after insert or update or delete on public.products for each row execute function public.record_audit();

revoke select on public.purchase_requests,public.purchase_batches from authenticated;
grant select(id,batch_id,supplier_id,customer_id,salesperson_id,product_id,original_product_description,requested_quantity,
 allocated_quantity,pending_quantity,customer_position,item_position,original_line,status,created_at,updated_at)
 on public.purchase_requests to authenticated;
grant select(id,supplier_id,batch_sequence,confirmed_at,confirmed_by,status,created_at,updated_at)
 on public.purchase_batches to authenticated;

create function public.import_invoice_xml(source text) returns uuid language plpgsql security definer set search_path='' as $$
declare
 doc xml;
 header record;
 line record;
 supplier_key uuid;
 invoice_key uuid;
 key_text text;
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

create function public.save_inspection(note_id uuid, items jsonb, comments text default null, complete boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
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
 if target.status='completed' then raise exception 'Conferência já finalizada'; end if;
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

create function public.resolve_occurrence(target uuid, justification text) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.current_profile_role() is null then raise exception 'Perfil sem permissão' using errcode='42501'; end if;
 if nullif(btrim(justification),'') is null then raise exception 'Informe a resolução'; end if;
 update public.occurrences set status='resolved',resolution_notes=justification,resolved_at=now(),resolved_by=auth.uid()
 where id=target and status='open';
end $$;

revoke all on function public.import_invoice_xml(text),public.save_inspection(uuid,jsonb,text,boolean),public.resolve_occurrence(uuid,text) from public,anon;
grant execute on function public.import_invoice_xml(text),public.save_inspection(uuid,jsonb,text,boolean),public.resolve_occurrence(uuid,text) to authenticated;
