-- =====================================================================
-- Design — encyclopédie visuelle: account, preferiti, contributi, punti
-- =====================================================================
-- Da eseguire una volta nel progetto Supabase: Dashboard → SQL Editor →
-- incolla tutto il file → Run. È idempotente: si può rieseguire dopo una
-- modifica senza perdere dati.
--
-- Modello:
--   profili            un profilo pubblico per ogni utente registrato
--   preferiti          designer / prodotti / aziende salvati dall'utente
--   contributi         proposte inviate dal form "Contribuisci"
--   regole_punti       quanti punti vale ogni tipo di contributo
--   movimenti_punti    registro di ogni punto assegnato (il totale sta in profili.punti)
--
-- Sicurezza: ogni tabella ha Row Level Security. Gli utenti leggono e
-- scrivono solo i propri dati; i punti si assegnano SOLO quando un admin
-- approva un contributo (funzione approva_contributo), mai dal browser.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Profili
-- ---------------------------------------------------------------------
create table if not exists public.profili (
  id          uuid primary key references auth.users (id) on delete cascade,
  nome        text not null default '' check (char_length(nome) <= 60),
  punti       integer not null default 0,
  ruolo       text not null default 'utente' check (ruolo in ('utente', 'admin')),
  creato_il   timestamptz not null default now()
);

alter table public.profili enable row level security;

-- Profili leggibili da tutti (servono per una futura classifica community).
drop policy if exists "profili leggibili da tutti" on public.profili;
create policy "profili leggibili da tutti" on public.profili
  for select using (true);

-- Ognuno modifica solo il proprio profilo...
drop policy if exists "profilo modificabile dal proprietario" on public.profili;
create policy "profilo modificabile dal proprietario" on public.profili
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ...e solo il nome: punti e ruolo non sono scrivibili dal browser.
revoke update on public.profili from anon, authenticated;
grant update (nome) on public.profili to authenticated;

-- Profilo creato automaticamente alla registrazione. Il nome arriva dai
-- metadati passati da supabase.auth.signUp({ options: { data: { nome } } }).
create or replace function public.crea_profilo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profili (id, nome)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'nome', 60), ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists crea_profilo_dopo_registrazione on auth.users;
create trigger crea_profilo_dopo_registrazione
  after insert on auth.users
  for each row execute function public.crea_profilo();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profili where id = auth.uid() and ruolo = 'admin')
$$;

-- ---------------------------------------------------------------------
-- Preferiti
-- ---------------------------------------------------------------------
-- elemento è il nome dell'entità così come compare nei dati del sito
-- (src/data/*.json). Per i prodotti, che possono avere nomi uguali, si usa
-- anche il file della foto: elemento = "<nome>|<foto>".
create table if not exists public.preferiti (
  utente_id   uuid not null references auth.users (id) on delete cascade default auth.uid(),
  tipo        text not null check (tipo in ('designer', 'prodotto', 'azienda')),
  elemento    text not null check (char_length(elemento) <= 300),
  creato_il   timestamptz not null default now(),
  primary key (utente_id, tipo, elemento)
);

alter table public.preferiti enable row level security;

drop policy if exists "preferiti del proprietario" on public.preferiti;
create policy "preferiti del proprietario" on public.preferiti
  for all using (auth.uid() = utente_id) with check (auth.uid() = utente_id);

-- ---------------------------------------------------------------------
-- Regole punti
-- ---------------------------------------------------------------------
create table if not exists public.regole_punti (
  tipo        text primary key,
  punti       integer not null check (punti >= 0),
  descrizione text not null default ''
);

insert into public.regole_punti (tipo, punti, descrizione) values
  ('correzione',   10, 'Correzione di un dato esistente'),
  ('aggiunta',     20, 'Nuovo designer, prodotto o azienda'),
  ('suggerimento',  5, 'Miglioramento o suggerimento'),
  ('bonus_foto',   10, 'Bonus per un contributo con fotografia')
on conflict (tipo) do nothing;

alter table public.regole_punti enable row level security;

drop policy if exists "regole leggibili da tutti" on public.regole_punti;
create policy "regole leggibili da tutti" on public.regole_punti
  for select using (true);

drop policy if exists "regole modificabili dagli admin" on public.regole_punti;
create policy "regole modificabili dagli admin" on public.regole_punti
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Contributi
-- ---------------------------------------------------------------------
create table if not exists public.contributi (
  id              bigint generated always as identity primary key,
  utente_id       uuid not null references auth.users (id) on delete cascade default auth.uid(),
  tipo            text not null check (tipo in ('correzione', 'aggiunta', 'suggerimento')),
  -- entità a cui si riferisce il contributo (facoltativa per le aggiunte)
  riferimento_tipo text check (riferimento_tipo in ('designer', 'prodotto', 'azienda')),
  riferimento     text check (char_length(riferimento) <= 300),
  descrizione     text not null check (char_length(descrizione) between 10 and 5000),
  fonte           text check (char_length(fonte) <= 1000),
  -- percorso del file nel bucket "contributi" (facoltativo)
  foto            text check (char_length(foto) <= 500),
  stato           text not null default 'in_attesa' check (stato in ('in_attesa', 'approvato', 'rifiutato')),
  punti_assegnati integer,
  nota_revisione  text,
  creato_il       timestamptz not null default now(),
  revisionato_il  timestamptz,
  revisionato_da  uuid references auth.users (id)
);

create index if not exists contributi_per_stato on public.contributi (stato, creato_il);
create index if not exists contributi_per_utente on public.contributi (utente_id, creato_il desc);

alter table public.contributi enable row level security;

drop policy if exists "contributi visibili al proprietario e agli admin" on public.contributi;
create policy "contributi visibili al proprietario e agli admin" on public.contributi
  for select using (auth.uid() = utente_id or public.is_admin());

-- Un utente può solo inviare contributi nuovi, a proprio nome e in attesa.
drop policy if exists "contributi inviabili dagli utenti" on public.contributi;
create policy "contributi inviabili dagli utenti" on public.contributi
  for insert with check (
    auth.uid() = utente_id
    and stato = 'in_attesa'
    and punti_assegnati is null
    and revisionato_il is null
    and revisionato_da is null
  );

-- Nessuna policy di update/delete: la revisione passa dalle funzioni sotto.

-- ---------------------------------------------------------------------
-- Registro punti
-- ---------------------------------------------------------------------
create table if not exists public.movimenti_punti (
  id            bigint generated always as identity primary key,
  utente_id     uuid not null references auth.users (id) on delete cascade,
  punti         integer not null,
  motivo        text not null,
  contributo_id bigint references public.contributi (id) on delete set null,
  creato_il     timestamptz not null default now()
);

alter table public.movimenti_punti enable row level security;

drop policy if exists "movimenti visibili al proprietario" on public.movimenti_punti;
create policy "movimenti visibili al proprietario" on public.movimenti_punti
  for select using (auth.uid() = utente_id or public.is_admin());

-- Il totale in profili.punti segue sempre il registro.
create or replace function public.aggiorna_totale_punti()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profili set punti = punti + new.punti where id = new.utente_id;
  return new;
end $$;

drop trigger if exists aggiorna_totale_punti on public.movimenti_punti;
create trigger aggiorna_totale_punti
  after insert on public.movimenti_punti
  for each row execute function public.aggiorna_totale_punti();

-- ---------------------------------------------------------------------
-- Revisione (solo admin)
-- ---------------------------------------------------------------------
-- punti_override: se null si usano regole_punti (+ bonus foto se presente).
create or replace function public.approva_contributo(contributo bigint, punti_override integer default null, nota text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  c public.contributi;
  totale integer;
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono approvare'; end if;
  select * into c from public.contributi where id = contributo for update;
  if not found then raise exception 'Contributo % inesistente', contributo; end if;
  if c.stato <> 'in_attesa' then raise exception 'Contributo già revisionato'; end if;

  totale := coalesce(punti_override,
    coalesce((select punti from public.regole_punti where tipo = c.tipo), 0)
    + case when c.foto is not null then coalesce((select punti from public.regole_punti where tipo = 'bonus_foto'), 0) else 0 end);

  update public.contributi
     set stato = 'approvato', punti_assegnati = totale, nota_revisione = nota,
         revisionato_il = now(), revisionato_da = auth.uid()
   where id = contributo;

  if totale <> 0 then
    insert into public.movimenti_punti (utente_id, punti, motivo, contributo_id)
    values (c.utente_id, totale, 'Contributo approvato: ' || c.tipo, c.id);
  end if;
  return totale;
end $$;

create or replace function public.rifiuta_contributo(contributo bigint, nota text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono rifiutare'; end if;
  update public.contributi
     set stato = 'rifiutato', punti_assegnati = 0, nota_revisione = nota,
         revisionato_il = now(), revisionato_da = auth.uid()
   where id = contributo and stato = 'in_attesa';
  if not found then raise exception 'Contributo inesistente o già revisionato'; end if;
end $$;

revoke execute on function public.approva_contributo(bigint, integer, text) from public, anon;
revoke execute on function public.rifiuta_contributo(bigint, text) from public, anon;
grant execute on function public.approva_contributo(bigint, integer, text) to authenticated;
grant execute on function public.rifiuta_contributo(bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- Permessi delle tabelle per la Data API
-- ---------------------------------------------------------------------
-- Espliciti, così lo schema funziona anche con "Grant API access to new
-- tables automatically" disattivato. Cosa si vede davvero lo decidono
-- comunque le policy RLS qui sopra.
-- Prima si tolgono i permessi ampi che Supabase concede di default (DELETE,
-- TRUNCATE…), poi si concede solo il minimo necessario.
revoke all on public.profili, public.preferiti, public.contributi, public.movimenti_punti, public.regole_punti from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.profili, public.regole_punti to anon, authenticated;
grant update (nome) on public.profili to authenticated;
grant select, insert, delete on public.preferiti to authenticated;
grant select, insert on public.contributi to authenticated;
grant select on public.movimenti_punti to authenticated;
grant insert, update, delete on public.regole_punti to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Foto dei contributi (Storage)
-- ---------------------------------------------------------------------
-- Bucket privato: ogni utente carica solo nella cartella col proprio id
-- (contributi/<id utente>/<file>), gli admin vedono tutto. Max 5 MB, solo immagini.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contributi', 'contributi', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "foto caricabili nella propria cartella" on storage.objects;
create policy "foto caricabili nella propria cartella" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'contributi' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "foto visibili al proprietario e agli admin" on storage.objects;
create policy "foto visibili al proprietario e agli admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'contributi' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------------
-- Diventare admin
-- ---------------------------------------------------------------------
-- Dopo esserti registrato sul sito, esegui (con la tua email):
--   update public.profili set ruolo = 'admin'
--   where id = (select id from auth.users where email = 'LA-TUA-EMAIL');
