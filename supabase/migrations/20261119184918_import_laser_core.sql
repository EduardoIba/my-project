create table public.user_profiles (
 id uuid primary key references auth.users(id), full_name text not null,
 role text not null check (role in ('comprador','conferente','administrador')),
 is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.suppliers (
 id uuid primary key default gen_random_uuid(), legal_name text not null unique, trade_name text, cnpj text unique check(cnpj ~ '^[0-9]{14}$'),
 contact_name text, phone text, email text, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.customers (
 id uuid primary key default gen_random_uuid(), name text not null, document text unique check(document ~ '^([0-9]{11}|[0-9]{14})$'),
 contact_name text, phone text, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.salespeople (
 id uuid primary key default gen_random_uuid(), name text not null unique, user_id uuid references public.user_profiles,
 is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.products (
 id uuid primary key default gen_random_uuid(), internal_code text not null unique, name text not null, brand text, model text, unit text not null,
 package_quantity numeric check(package_quantity > 0), gtin text, is_active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.product_equivalences (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products, supplier_id uuid not null references public.suppliers,
 supplier_product_code text not null, external_description text, gtin text, source_unit text not null,
 source_package_quantity numeric check(source_package_quantity > 0), conversion_factor numeric not null check(conversion_factor > 0),
 validation_status text not null default 'pending' check(validation_status in ('pending','validated','rejected')),
 validated_by uuid references public.user_profiles, validated_at timestamptz, created_at timestamptz not null default now(),
 check(validation_status <> 'validated' or (validated_by is not null and validated_at is not null))
);
create unique index validated_supplier_code on public.product_equivalences(supplier_id,supplier_product_code,source_unit) where validation_status='validated';
create table public.purchase_batches (
 id uuid primary key default gen_random_uuid(), supplier_id uuid references public.suppliers, batch_sequence bigint generated always as identity unique,
 original_message text not null default '', confirmed_at timestamptz not null default now(), confirmed_by uuid not null references public.user_profiles,
 status text not null default 'confirmed' check(status in ('confirmed','archived')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.purchase_requests (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.purchase_batches, supplier_id uuid references public.suppliers,
 customer_id uuid not null references public.customers, salesperson_id uuid references public.salespeople, product_id uuid references public.products,
 original_product_description text not null, requested_quantity numeric(16,4) not null check(requested_quantity > 0),
 allocated_quantity numeric(16,4) not null default 0 check(allocated_quantity between 0 and requested_quantity),
 pending_quantity numeric(16,4) generated always as (requested_quantity - allocated_quantity) stored,
 customer_position integer not null check(customer_position > 0), item_position integer not null check(item_position > 0), original_line text,
 status text not null default 'open' check(status in ('open','cancelled','archived')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(batch_id,customer_position,item_position)
);
create index purchase_request_distribution on public.purchase_requests(product_id,supplier_id,batch_id,customer_position,item_position) where status='open';
create table public.purchase_entries (
 id uuid primary key default gen_random_uuid(), purchase_request_id uuid not null references public.purchase_requests, supplier_id uuid not null references public.suppliers,
 product_id uuid references public.products, quantity numeric(16,4) not null check(quantity > 0), unit_price numeric(18,6) not null check(unit_price >= 0),
 total_amount numeric generated always as (round(quantity * unit_price,2)) stored,
 operation_type text not null default 'purchase' check(operation_type in ('purchase','correction')),
 operation_group_id uuid, replaces_id uuid unique references public.purchase_entries, purchase_date date, purchased_at timestamptz,
 status text not null default 'active' check(status in ('active','voided')), voided_at timestamptz, reason text,
 created_by uuid not null references public.user_profiles, created_at timestamptz not null default now(),
 unique(purchase_request_id,operation_group_id),
 check((status='voided') = (voided_at is not null))
);
create index purchase_entry_request on public.purchase_entries(purchase_request_id);
create table public.invoices (
 id uuid primary key default gen_random_uuid(), access_key text not null unique check(access_key ~ '^[0-9]{44}$'),
 invoice_number text not null, series text not null, supplier_id uuid not null references public.suppliers,
 issuer_cnpj text not null check(issuer_cnpj ~ '^[0-9]{14}$'), recipient_cnpj text not null check(recipient_cnpj ~ '^[0-9]{14}$'),
 issued_at timestamptz not null, xml_storage_path text not null unique, xml_import_method text not null,
 validation_status text not null default 'pending' check(validation_status in ('pending','validated','rejected')),
 status text not null default 'imported' check(status in ('imported','received')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.invoice_items (
 id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices,
 item_number integer not null check(item_number > 0), supplier_product_code text not null, description text not null,
 gtin text, unit text not null, invoiced_quantity numeric(20,4) not null check(invoiced_quantity > 0),
 unit_price numeric(24,10) not null check(unit_price >= 0), total_amount numeric(20,2) not null check(total_amount >= 0),
 product_id uuid references public.products, matching_status text not null default 'unmatched' check(matching_status in ('unmatched','matched','substitution')),
 created_at timestamptz not null default now(), unique(invoice_id,item_number), unique(invoice_id,id)
);
create table public.receiving_inspections (
 id uuid primary key default gen_random_uuid(), invoice_id uuid not null unique references public.invoices,
 inspector_id uuid not null references public.user_profiles, status text not null default 'in_progress' check(status in ('in_progress','completed')),
 started_at timestamptz not null default now(), completed_at timestamptz, notes text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,invoice_id),
 check((status='completed') = (completed_at is not null))
);
create table public.inspection_items (
 id uuid primary key default gen_random_uuid(), inspection_id uuid not null, invoice_id uuid not null, invoice_item_id uuid not null,
 product_id uuid references public.products, invoiced_quantity numeric(20,4) not null check(invoiced_quantity > 0),
 received_quantity numeric(20,4) not null check(received_quantity >= 0),
 quantity_difference numeric generated always as (received_quantity-invoiced_quantity) stored,
 matching_status text not null check(matching_status in ('unmatched','matched','substitution')), notes text,
 updated_at timestamptz not null default now(), unique(inspection_id,invoice_item_id), unique(id,inspection_id,invoice_item_id),
 foreign key(inspection_id,invoice_id) references public.receiving_inspections(id,invoice_id),
 foreign key(invoice_id,invoice_item_id) references public.invoice_items(invoice_id,id),
 check((matching_status='unmatched') = (product_id is null)),
 check(matching_status <> 'substitution' or nullif(btrim(notes),'') is not null)
);
create table public.allocations (
 id uuid primary key default gen_random_uuid(), inspection_id uuid not null, inspection_item_id uuid not null,
 invoice_item_id uuid not null, purchase_request_id uuid not null references public.purchase_requests, customer_id uuid not null references public.customers,
 product_id uuid not null references public.products, allocated_quantity numeric(16,4) not null check(allocated_quantity > 0),
 allocation_type text not null default 'priority' check(allocation_type in ('priority')), created_by uuid not null references public.user_profiles,
 created_at timestamptz not null default now(), unique(inspection_item_id,purchase_request_id),
 foreign key(inspection_item_id,inspection_id,invoice_item_id) references public.inspection_items(id,inspection_id,invoice_item_id)
);
create index allocation_request on public.allocations(purchase_request_id);
create table public.occurrences (
 id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices, inspection_id uuid, invoice_item_id uuid,
 purchase_request_id uuid references public.purchase_requests, occurrence_type text not null check(occurrence_type in ('shortage','excess','substitution','unknown_product','packaging')),
 expected_product_id uuid references public.products, received_product_id uuid references public.products,
 expected_quantity numeric check(expected_quantity >= 0), received_quantity numeric check(received_quantity >= 0),
 description text not null, resolution_notes text, status text not null default 'open' check(status in ('open','resolved')),
 created_by uuid not null references public.user_profiles, resolved_by uuid references public.user_profiles,
 created_at timestamptz not null default now(), resolved_at timestamptz,
 foreign key(inspection_id,invoice_id) references public.receiving_inspections(id,invoice_id),
 foreign key(invoice_id,invoice_item_id) references public.invoice_items(invoice_id,id),
 check(status <> 'resolved' or (resolved_by is not null and resolved_at is not null and nullif(btrim(resolution_notes),'') is not null))
);
create table public.audit_logs (
 id bigint generated always as identity primary key, user_id uuid references public.user_profiles, entity_type text not null,
 entity_id uuid not null, action text not null, previous_data jsonb, new_data jsonb, reason text, created_at timestamptz not null default now()
);
create index audit_entity on public.audit_logs(entity_type,entity_id,created_at);
