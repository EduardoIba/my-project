alter table public.user_profiles add column username text unique
 check (username ~ '^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$');

-- Only the Auth Admin API can supply the reserved UUID and trusted app metadata.
-- Auth creates the row before setting app metadata and confirming its email.
create function public.guard_master_auth_identity() returns trigger
language plpgsql set search_path='' as $$
declare
 master_email constant text := 'eduardo@login.importlaser.invalid';
begin
 if (lower(new.email) is not distinct from master_email) <> (new.id='5366f3fe-a2f7-4150-8c70-985f9097b4e0'::uuid) then
  raise exception 'O alias do administrador é reservado';
 end if;
 return new;
end $$;

create function public.attach_master_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.user_profiles(id,username,full_name,role)
 values(new.id,'eduardo','Eduardo','administrador') on conflict(id) do nothing;
 return new;
end $$;

revoke all on function public.guard_master_auth_identity(),public.attach_master_profile() from public,anon,authenticated;
create trigger import_laser_guard_master_identity
 before insert or update of id, email on auth.users
 for each row execute function public.guard_master_auth_identity();
create trigger import_laser_attach_master_profile
 after insert or update of raw_app_meta_data, email_confirmed_at on auth.users
 for each row
 when (new.id='5366f3fe-a2f7-4150-8c70-985f9097b4e0'::uuid and lower(new.email)='eduardo@login.importlaser.invalid'
  and new.email_confirmed_at is not null and new.raw_app_meta_data->>'import_laser_account'='master-eduardo-v1')
 execute function public.attach_master_profile();

do $$
declare
 table_name text;
begin
 foreach table_name in array array['purchase_batches','purchase_requests','purchase_entries','salespeople'] loop
  execute format('alter policy read_allowed on public.%I using ((select public.current_profile_role()) in (''comprador'',''administrador''))',table_name);
 end loop;
 foreach table_name in array array['product_equivalences','invoices','invoice_items','receiving_inspections','inspection_items','allocations'] loop
  execute format('alter policy read_allowed on public.%I using ((select public.current_profile_role()) in (''conferente'',''administrador''))',table_name);
 end loop;
end $$;

create or replace function public.get_invoice_xml(note_id uuid) returns text
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.current_profile_role(),'') not in ('conferente','administrador') then
  raise exception 'Perfil sem permissão' using errcode='42501';
 end if;
 return (select source from public.invoice_xml_sources where invoice_id=note_id);
end $$;

alter policy read_invoice_xml on storage.objects using (
 bucket_id='nfe-xml' and (select public.current_profile_role()) in ('conferente','administrador')
);
