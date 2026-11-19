create function public.receiving_pending_requests()
returns table (request_id uuid, supplier_id uuid, supplier_name text, customer_name text, product_id uuid,
 product_name text, batch_sequence bigint, customer_position integer, item_position integer, pending_quantity numeric, confirmed_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.current_profile_role(),'') not in ('conferente','administrador') then
  raise exception 'Perfil sem permissão' using errcode='42501';
 end if;
 return query
 select r.id,r.supplier_id,coalesce(s.trade_name,s.legal_name),c.name,r.product_id,
  coalesce(p.name,r.original_product_description),b.batch_sequence,r.customer_position,r.item_position,r.pending_quantity,b.confirmed_at
 from public.purchase_requests r
 join public.purchase_batches b on b.id=r.batch_id
 join public.customers c on c.id=r.customer_id
 left join public.suppliers s on s.id=r.supplier_id
 left join public.products p on p.id=r.product_id
 where r.status='open' and b.status='confirmed' and r.pending_quantity>0
 order by b.batch_sequence,r.customer_position,r.item_position;
end $$;

revoke all on function public.receiving_pending_requests() from public,anon;
grant execute on function public.receiving_pending_requests() to authenticated;
