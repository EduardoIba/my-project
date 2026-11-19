create function public.assign_batch_sequence() returns trigger
language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(674901);
 select coalesce(max(batch_sequence),0)+1 into new.batch_sequence from public.purchase_batches;
 return new;
end $$;
revoke all on function public.assign_batch_sequence() from public,anon,authenticated;
create trigger assign_batch_sequence before insert on public.purchase_batches
 for each row execute function public.assign_batch_sequence();

-- The original is stored atomically in invoice_xml_sources; clients never upload unrelated objects.
drop policy insert_invoice_xml on storage.objects;
