begin;
do $$
declare
 master_id constant uuid := '5366f3fe-a2f7-4150-8c70-985f9097b4e0';
 buyer_id uuid := gen_random_uuid();
 inspector_id uuid := gen_random_uuid();
 supplier_id uuid;
 batch_id uuid;
 note_id uuid;
 test_customer uuid;
 test_request uuid;
begin
 begin
  insert into auth.users(id,email,raw_user_meta_data)
  values(gen_random_uuid(),'eduardo@login.importlaser.invalid','{"import_laser_account":"master-eduardo-v1","role":"administrador"}');
  raise exception 'Cadastro publico aceitou o alias reservado' using errcode='XX000';
 exception when raise_exception then
  if sqlerrm<>'O alias do administrador é reservado' then raise; end if;
 end;

 if not exists(select 1 from auth.users where id=master_id) then
  insert into auth.users(id,email) values(master_id,'eduardo@login.importlaser.invalid');
  if exists(select 1 from public.user_profiles where id=master_id) then raise exception 'Perfil concedido antes da confirmacao'; end if;
  update auth.users set raw_app_meta_data='{"import_laser_account":"master-eduardo-v1"}' where id=master_id;
  if exists(select 1 from public.user_profiles where id=master_id) then raise exception 'Perfil concedido sem confirmar o alias'; end if;
  update auth.users set email_confirmed_at=now() where id=master_id;
 end if;

 insert into auth.users(id,email) values
 (buyer_id,buyer_id||'@example.invalid'),(inspector_id,inspector_id||'@example.invalid');
 insert into public.user_profiles(id,full_name,role) values
 (buyer_id,'Comprador teste','comprador'),(inspector_id,'Conferente teste','conferente');

 begin
  update auth.users set email='outro@login.importlaser.invalid' where id=master_id;
  raise exception 'Mudanca do alias reservado aceita' using errcode='XX000';
 exception when raise_exception then
  if sqlerrm<>'O alias do administrador é reservado' then raise; end if;
 end;

 insert into public.suppliers(legal_name) values('Teste RLS '||buyer_id) returning id into supplier_id;
 insert into public.purchase_batches(confirmed_by,buyer_data)
 values(buyer_id,jsonb_build_object('id','teste-rls')) returning id into batch_id;
 insert into public.customers(name) values('Cliente teste da conferência') returning id into test_customer;
 insert into public.purchase_requests(batch_id,supplier_id,customer_id,original_product_description,requested_quantity,customer_position,item_position)
 values(batch_id,supplier_id,test_customer,'Produto teste',3,1,1) returning id into test_request;
 insert into public.invoices(access_key,invoice_number,series,supplier_id,issuer_cnpj,recipient_cnpj,issued_at,xml_storage_path,xml_import_method)
 values('35261198765432000199550010000001231111111119','123','1',supplier_id,'98765432000199','12345678000199',now(),
  buyer_id||'.xml','test') returning id into note_id;
 insert into public.invoice_xml_sources values(note_id,'<test/>');

 execute 'set local role authenticated';
 perform set_config('request.jwt.claim.sub',master_id::text,true);
 if public.current_profile_role() is distinct from 'administrador'
  or not exists(select 1 from public.user_profiles where id=master_id and username='eduardo')
  or not exists(select id from public.purchase_batches where id=batch_id)
  or not exists(select 1 from public.invoices where id=note_id)
  or public.get_invoice_xml(note_id) is distinct from '<test/>' then
  raise exception 'Master sem acesso completo';
 end if;

 perform set_config('request.jwt.claim.sub',buyer_id::text,true);
 if public.current_profile_role() is distinct from 'comprador'
  or not exists(select id from public.purchase_batches where id=batch_id)
  or exists(select 1 from public.invoices where id=note_id)
  or exists(select 1 from public.user_profiles where id=master_id) then
  raise exception 'RLS do comprador incorreta';
 end if;
 begin
  perform public.get_invoice_xml(note_id);
  raise exception 'Comprador conseguiu baixar XML';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.receiving_pending_requests();
  raise exception 'Comprador conseguiu chamar a RPC de Conferência';
 exception when insufficient_privilege then null;
 end;
 begin
  update public.user_profiles set role='administrador' where id=buyer_id;
  raise exception 'Comprador conseguiu elevar o proprio perfil';
 exception when insufficient_privilege then null;
 end;

 perform set_config('request.jwt.claim.sub',inspector_id::text,true);
 if public.current_profile_role() is distinct from 'conferente'
  or not exists(select 1 from public.invoices where id=note_id)
  or exists(select id from public.purchase_batches where id=batch_id) then
  raise exception 'RLS do conferente incorreta';
 end if;
 begin
  perform public.load_buyer_workspace();
  raise exception 'Conferente conseguiu acessar Compras';
 exception when insufficient_privilege then null;
 end;
 if not exists(select 1 from public.receiving_pending_requests() p where p.request_id=test_request
  and p.pending_quantity=3 and p.product_name='Produto teste') then
  raise exception 'Pendência indisponível para o conferente';
 end if;
 execute 'reset role';
end $$;
rollback;
select 'master_login_ok' as result;
