# Account, preferiti e punti community — configurazione

Il sito resta statico su GitHub Pages. Gli account vivono su **Supabase**
(autenticazione + database Postgres), le email partono da **Resend**.
Senza configurazione il sito funziona esattamente come prima e la voce
"Accedi" non compare.

## 1. Progetto Supabase

1. Crea un progetto gratuito su <https://supabase.com> (regione: Europe).
2. **SQL Editor** → incolla tutto `supabase/schema.sql` → **Run**.
   Lo script si può rieseguire senza perdere dati.
3. **Authentication → URL Configuration**
   - Site URL: `https://design.encyclopedie-visuelle.com`
   - Redirect URLs: `https://design.encyclopedie-visuelle.com/**` e, per lo
     sviluppo, `http://localhost:5173/**`
4. **Project Settings → API**: copia *Project URL* e *anon public key*.

## 2. Email con Resend

1. Su <https://resend.com> aggiungi e verifica il dominio
   `encyclopedie-visuelle.com` (record DNS che Resend indica).
2. Crea una API key (permesso "Sending access").
3. In Supabase: **Authentication → Emails → SMTP Settings** → abilita SMTP:
   - Host `smtp.resend.com`, porta `465`, utente `resend`
   - Password: la API key di Resend
   - Mittente: ad es. `accesso@encyclopedie-visuelle.com`
4. (Facoltativo) **Authentication → Emails → Templates**: traduci in italiano
   i testi di conferma, link di accesso e reset password.

La chiave di Resend resta solo dentro Supabase: il sito non la vede mai.

## 3. Pubblicazione

GitHub → repository → **Settings → Secrets and variables → Actions →
Variables** → crea:

| Nome | Valore |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | anon public key |

Al prossimo deploy di `main` compare la voce "Accedi" nel menu.
In locale: copia `.env.example` in `.env.local` con gli stessi valori.

## 4. Diventare admin

Registrati sul sito, poi nel SQL Editor:

```sql
update public.profili set ruolo = 'admin'
where id = (select id from auth.users where email = 'LA-TUA-EMAIL');
```

Nel pannello "Il mio account" comparirà la sezione **Da revisionare**: per
ogni contributo puoi approvare (punti automatici da `regole_punti`, oppure un
numero a scelta) o rifiutare.

## Punti

Valori iniziali in `regole_punti` (modificabili dal Table Editor):

| tipo | punti |
| --- | --- |
| correzione | 10 |
| aggiunta | 20 |
| suggerimento | 5 |
| bonus_foto | +10 se il contributo ha una foto |

I punti si assegnano **solo** all'approvazione di un admin e ogni
assegnazione resta registrata in `movimenti_punti`. Le regole di sicurezza
impediscono agli utenti di modificare punti, ruolo o contributi altrui.
