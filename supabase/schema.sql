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
  cognome     text not null default '' check (char_length(cognome) <= 60),
  punti       integer not null default 0,
  ruolo       text not null default 'utente' check (ruolo in ('utente', 'admin')),
  creato_il   timestamptz not null default now()
);

-- Aggiunta successiva: per i progetti creati prima che esistesse la colonna.
alter table public.profili add column if not exists cognome text not null default '' check (char_length(cognome) <= 60);

alter table public.profili enable row level security;

-- Profili privati: ognuno vede solo il proprio, gli admin vedono tutti.
-- (Prima erano leggibili da chiunque per una futura classifica: tolto il
-- 2026-11-19, nome e cognome non devono essere pubblici.)
drop policy if exists "profili leggibili da tutti" on public.profili;
drop policy if exists "profilo visibile al proprietario e agli admin" on public.profili;
create policy "profilo visibile al proprietario e agli admin" on public.profili
  for select using (auth.uid() = id or public.is_admin());

-- Ognuno modifica solo il proprio profilo...
drop policy if exists "profilo modificabile dal proprietario" on public.profili;
create policy "profilo modificabile dal proprietario" on public.profili
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ...e solo nome e cognome: punti e ruolo non sono scrivibili dal browser.
revoke update on public.profili from anon, authenticated;
grant update (nome, cognome) on public.profili to authenticated;

-- Profilo creato automaticamente alla registrazione. Nome e cognome arrivano
-- dai metadati: dal modulo del sito (signUp con data: { nome, cognome }) oppure
-- da Google/Apple (given_name / family_name, o full_name come ultima risorsa).
create or replace function public.crea_profilo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nome_completo text := coalesce(m ->> 'full_name', m ->> 'name', '');
begin
  insert into public.profili (id, nome, cognome)
  values (
    new.id,
    left(coalesce(nullif(m ->> 'nome', ''), nullif(m ->> 'given_name', ''), split_part(nome_completo, ' ', 1)), 60),
    left(coalesce(nullif(m ->> 'cognome', ''), nullif(m ->> 'family_name', ''),
      trim(substr(nome_completo, length(split_part(nome_completo, ' ', 1)) + 1))), 60)
  )
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
grant select on public.regole_punti to anon, authenticated;
grant select on public.profili to authenticated;
grant update (nome, cognome) on public.profili to authenticated;
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

drop policy if exists "foto eliminabili dal proprietario e dagli admin" on storage.objects;
create policy "foto eliminabili dal proprietario e dagli admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'contributi' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------------
-- Cancellazione degli account
-- ---------------------------------------------------------------------
-- Cancellare la riga in auth.users elimina a cascata profilo, preferiti,
-- contributi e movimenti punti. Le foto nello Storage non si possono
-- cancellare da SQL: il sito le rimuove con l'API Storage prima di chiamare
-- queste funzioni (vedi src/account/useAccount.js).

-- Un admin cancellato non deve bloccare la cancellazione: le revisioni che
-- aveva fatto restano, senza autore.
alter table public.contributi drop constraint if exists contributi_revisionato_da_fkey;
alter table public.contributi add constraint contributi_revisionato_da_fkey
  foreign key (revisionato_da) references auth.users (id) on delete set null;

-- Dal proprio account: "Elimina account".
create or replace function public.elimina_mio_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- Dal pannello admin, per le richieste arrivate via email.
create or replace function public.elimina_utente(utente uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono eliminare account'; end if;
  delete from auth.users where id = utente;
  if not found then raise exception 'Utente inesistente'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Iscritti (solo admin)
-- ---------------------------------------------------------------------
create or replace function public.elenco_iscritti()
returns table (
  id uuid, email text, nome text, cognome text, metodi text[],
  creato_il timestamptz, ultimo_accesso timestamptz, confermato boolean, punti integer, ruolo text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono vedere gli iscritti'; end if;
  return query
    select u.id, u.email::text, coalesce(p.nome, ''), coalesce(p.cognome, ''),
           coalesce(array(select jsonb_array_elements_text(u.raw_app_meta_data -> 'providers')), array[]::text[]),
           u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null,
           coalesce(p.punti, 0), coalesce(p.ruolo, 'utente')
      from auth.users u
      left join public.profili p on p.id = u.id
     order by u.created_at desc;
end $$;

revoke execute on function public.elimina_mio_account() from public, anon;
revoke execute on function public.elimina_utente(uuid) from public, anon;
revoke execute on function public.elenco_iscritti() from public, anon;
grant execute on function public.elimina_mio_account() to authenticated;
grant execute on function public.elimina_utente(uuid) to authenticated;
grant execute on function public.elenco_iscritti() to authenticated;

-- ---------------------------------------------------------------------
-- Diventare admin
-- ---------------------------------------------------------------------
-- Dopo esserti registrato sul sito, esegui (con la tua email):
--   update public.profili set ruolo = 'admin'
--   where id = (select id from auth.users where email = 'LA-TUA-EMAIL');
