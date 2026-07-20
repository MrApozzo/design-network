#!/usr/bin/env python3
"""
download_product_images.py

Workflow completo per costruire una cartella di immagini standardizzate
(sfondo bianco, prodotto centrato, padding ampio, adatte a crop circolare)
a partire da un database JSON di prodotti di design.

Ricerca immagini: SearchApi.io (engine google_images) via REST API.
Standardizzazione sfondo: solo white-threshold + flood fill (niente rembg).

USO (dalla RADICE del progetto, es. design-network/):
    set SEARCHAPI_KEY=la_tua_chiave        (Windows)
    py download_product_images.py --limit 20

    # per processare tutto il database dopo il test:
    py download_product_images.py --all --zip

    Legge di default: src/data/prodotti.json
    Immagini buone salvate in:  immagini/           (visibili sul sito)
    Originali, dubbie, report:  _pipeline/

Dipendenze:
    pip install requests pandas Pillow rembg onnxruntime

Note importanti:
    - Lo script NON reinventa immagini: pulisce e standardizza quella trovata.
    - Scarica automaticamente solo confidence alta/media.
    - Se lo sfondo non e' neutralizzabile in sicurezza -> review_images/.
    - Non sovrascrive immagini finali gia' esistenti (idempotente).
"""

import argparse
import csv
import io
import json
import os
import re
import sys
import time
import unicodedata
import zipfile
from collections import deque
from urllib.parse import urlparse

import requests

try:
    from PIL import Image, ImageChops, ImageFilter
except ImportError:
    print("ERRORE: manca Pillow. Esegui: pip install Pillow", file=sys.stderr)
    sys.exit(1)

# pandas e' usato solo per i CSV; se manca ripieghiamo su csv stdlib
try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False


# --------------------------------------------------------------------------- #
# Configurazione
# --------------------------------------------------------------------------- #

SEARCHAPI_ENDPOINT = "https://www.searchapi.io/api/v1/search"

# --- Struttura cartelle adattata al progetto Vite/React ---
# Le immagini BUONE vanno nella cartella del sito: public/immagini.
# Tutto il resto (originali, dubbie, report) va sotto "_pipeline/".
IMAGES_DIR = os.path.join("public", "immagini")   # <-- immagini finali visibili sul sito
PIPELINE_DIR = "_pipeline"       # <-- cartella tecnica, fuori dal sito
ORIGINALS_SUB = "images_original"
REVIEW_SUB = "review_images"
SCARTI_SUB = "scarti"            # <-- ci trascini le immagini bocciate

# livello minimo di confidence per pubblicare direttamente nel sito.
# "alta"  = severo: nel sito solo immagini molto affidabili; il resto in review.
# "media" = permissivo: anche le probabili vanno nel sito.
AUTO_PUBLISH_MIN = "alta"

# soglia minima di qualita' dello scontorno (0-100). Sotto questa, l'immagine
# viene segnalata in review come "scontorno incerto" e, se ci sono altri
# candidati, lo script prova il successivo tenendo il migliore.
CUTOUT_QUALITY_MIN = 70

# --- Pulizia alone dello scontorno (media: soglia + erosione 1px) ---
ALPHA_THRESHOLD = 200   # sopra = soggetto pieno, sotto = sfondo (toglie la sfumatura)
ALPHA_ERODE_PX = 0      # 0 = non mangia il bordo; evita ritagli troppo aggressivi
ALPHA_FEATHER = 0.5     # micro-sfumatura finale per non lasciare il bordo seghettato

# canvas finale
FINAL_SIZE = 1000            # px, quadrato (sufficiente per crop circolare + peso contenuto)
TARGET_FILL = 0.70           # il prodotto occupa ~65-75% del lato utile

# peso finale target del file JPEG
TARGET_KB = 150              # peso desiderato indicativo
MAX_KB = 200                 # tetto massimo: non superare
JPEG_Q_START = 90            # qualita' iniziale, ridotta in modo adattivo se serve
JPEG_Q_MIN = 60              # qualita' minima accettabile prima di ridurre il lato
SAFE_MARGIN_MIN = 0.12       # margine di sicurezza minimo per lato

# soglie per il rilevamento "sfondo bianco"
WHITE_THRESHOLD = 245        # un pixel e' "bianco" se R,G,B >= soglia
BORDER_WHITE_FRACTION = 0.92 # piu' severo: salta rembg solo se lo sfondo e' davvero pulito

# rete
REQUEST_TIMEOUT = 25
DOWNLOAD_RETRIES = 2
SERP_RETRIES = 2
SLEEP_BETWEEN = 0.8          # gentile con l'API

# domini preferiti (fonte piu' importante della somiglianza visiva)
PREFERRED_DOMAINS = [
    "flos.com", "zanotta.com", "artemide.com", "cassina.com", "kartell.com",
    "alessi.com", "bebitalia.com", "molteni.it", "vitra.com", "hermanmiller.com",
    "poltronova.it", "memphis-milano.com", "danesemilano.com", "oluce.com",
    "tacchini.it", "arflex.com", "bonacina1889.it", "knoll.com", "magisdesign.com",
    "driade.com", "gebrueder-thonet.com", "santacole.com", "astep.se",
    "olivari.it", "riva1920.it", "produzioneprivata.it", "glasitalia.com",
    "venini.com", "fontanaarte.com", "martinelliluce.it",
    # musei / archivi / fondazioni
    "moma.org", "vam.ac.uk", "triennale.org", "fondazioneachillecastiglioni.it",
    "designmuseum.org", "adk.de", "vitradesignmuseum.de", "metmuseum.org",
    "collection.cooperhewitt.org", "cooperhewitt.org",
    # case d'asta affidabili
    "phillips.com", "sothebys.com", "christies.com", "wright20.com",
    "bukowskis.com", "cambiaste.com", "dorotheum.com", "artnet.com",
    "1stdibs.com", "pamono.com", "pamono.it",
]

# domini penalizzati
PENALIZED_DOMAINS = [
    "pinterest.", "amazon.", "ebay.", "aliexpress.", "etsy.",
    "wallapop.", "subito.it", "facebook.", "instagram.",
    "wordpress.", "blogspot.", "tumblr.",
]

# stopword per lo slug quando 'foto' e' assente
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}


# --------------------------------------------------------------------------- #
# Utility
# --------------------------------------------------------------------------- #

def log_error(paths, message):
    with open(paths["log_errors"], "a", encoding="utf-8") as fh:
        fh.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")


def slugify(value):
    value = str(value)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^\w\s-]", "", value).strip().lower()
    value = re.sub(r"[\s_-]+", "_", value)
    return value or "prodotto"


def principal_designer(designer):
    if isinstance(designer, list):
        return designer[0] if designer else ""
    return designer or ""


def all_designers_str(designer):
    if isinstance(designer, list):
        return ", ".join(designer)
    return designer or ""


_existing_basenames_cache = {}


def refresh_present_cache(images_dir):
    """Rilegge da disco i nomi base presenti in images_dir (una volta per run)."""
    key = os.path.abspath(images_dir)
    names = set()
    if os.path.isdir(images_dir):
        for f in os.listdir(images_dir):
            names.add(os.path.splitext(f)[0].lower())
    _existing_basenames_cache[key] = names
    return names


def _already_present(images_dir, base_no_ext):
    """
    True se in images_dir esiste un file con lo stesso nome base (ignorando
    estensione e maiuscole/minuscole). Usa il cache riletto a inizio run.
    """
    key = os.path.abspath(images_dir)
    if key not in _existing_basenames_cache:
        refresh_present_cache(images_dir)
    return base_no_ext.lower() in _existing_basenames_cache[key]


import re as _re_suffix

_SUFFIX_RE = _re_suffix.compile(r"^(.*)_(\d+)$")


def strip_scarto_suffix(base):
    """'castiglioni-arco_2' -> 'castiglioni-arco'. Se non c'e' suffisso, invariato."""
    m = _SUFFIX_RE.match(base)
    return m.group(1) if m else base


def renumber_scarti(scarti_dir):
    """
    All'inizio della run: per ogni file in scarti/ che ha ancora il nome base
    'pulito' (senza suffisso _N), lo rinomina al primo progressivo libero.
    Cosi' il nome base resta sempre disponibile e trascinare una nuova immagine
    bocciata non genera conflitti di sovrascrittura.
    Ritorna il numero di file rinominati.
    """
    if not os.path.isdir(scarti_dir):
        return 0
    files = os.listdir(scarti_dir)
    renamed = 0
    for f in files:
        base, ext = os.path.splitext(f)
        if _SUFFIX_RE.match(base):
            continue  # ha gia' un suffisso _N: lascia stare
        # trova il primo progressivo libero per questo prodotto
        n = 1
        while True:
            candidate = f"{base}_{n}{ext}"
            if not os.path.exists(os.path.join(scarti_dir, candidate)):
                break
            n += 1
        try:
            os.rename(os.path.join(scarti_dir, f),
                      os.path.join(scarti_dir, candidate))
            renamed += 1
        except Exception:  # noqa: BLE001
            pass
    return renamed


def load_rejections(paths):
    """
    Costruisce la memoria degli scarti: per ogni prodotto (nome base, senza
    suffisso _N), l'insieme degli URL immagine gia' bocciati.

    Flusso:
      1. rinumera i file 'puliti' in scarti/ (arco.jpg -> arco_1.jpg) cosi' il
         nome base resta libero e non hai piu' conflitti di sovrascrittura.
      2. per ogni file in scarti/, capisce a quale prodotto appartiene togliendo
         il suffisso _N, e recupera l'URL con cui era stato scaricato leggendo
         la mappa persistente review_urls.json (aggiornata a ogni salvataggio).
      3. accumula tutto in scartati.json (persistente).
    Ritorna: dict { base_prodotto(lower) : set(url_scartati) }
    """
    scarti_dir = paths["scarti_dir"]

    # 1) rinumera i nomi 'puliti' cosi' il nome base torna libero
    renumber_scarti(scarti_dir)

    # 2) memoria storica persistente degli scarti
    rejected = {}
    if os.path.exists(paths["rejected_json"]):
        try:
            with open(paths["rejected_json"], "r", encoding="utf-8") as fh:
                rejected = {k: set(v) for k, v in json.load(fh).items()}
        except Exception:  # noqa: BLE001
            rejected = {}

    # 3) mappa base_prodotto -> ultimo url usato (persistente, sopravvive alle run)
    base_to_url = {}
    if os.path.exists(paths["review_urls_json"]):
        try:
            with open(paths["review_urls_json"], "r", encoding="utf-8") as fh:
                base_to_url = json.load(fh)
        except Exception:  # noqa: BLE001
            base_to_url = {}
    # ripiego: se manca la mappa, prova col manifest (solo ultima run)
    if os.path.exists(paths["manifest"]):
        try:
            with open(paths["manifest"], "r", encoding="utf-8", newline="") as fh:
                for r in csv.DictReader(fh):
                    fn = (r.get("filename_finale") or "").strip()
                    url = (r.get("image_url") or "").strip()
                    if fn and url:
                        base_to_url.setdefault(os.path.splitext(fn)[0].lower(), url)
        except Exception:  # noqa: BLE001
            pass

    # 4) per ogni file in scarti/, risali al prodotto (togliendo _N) e al suo url
    if os.path.isdir(scarti_dir):
        for f in os.listdir(scarti_dir):
            base_num = os.path.splitext(f)[0].lower()      # es. castiglioni-arco_2
            prodotto = strip_scarto_suffix(base_num)        # es. castiglioni-arco
            url = base_to_url.get(prodotto)
            if url:
                rejected.setdefault(prodotto, set()).add(url)

    # 5) salva la memoria aggiornata
    try:
        with open(paths["rejected_json"], "w", encoding="utf-8") as fh:
            json.dump({k: sorted(v) for k, v in rejected.items()},
                      fh, ensure_ascii=False, indent=2)
    except Exception:  # noqa: BLE001
        pass

    return rejected


def record_review_url(paths, base_no_ext, url):
    """
    Registra (in modo persistente) l'URL con cui e' stata scaricata l'immagine
    salvata in review per questo prodotto. Serve a ricostruire quale URL scartare
    quando poi sposti l'immagine in scarti/, anche a distanza di run.
    """
    if not url:
        return
    data = {}
    p = paths["review_urls_json"]
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:  # noqa: BLE001
            data = {}
    data[base_no_ext.lower()] = url
    try:
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
    except Exception:  # noqa: BLE001
        pass


def in_review_basenames(paths):
    """Nomi base gia' presenti in review_images/ (in attesa di giudizio)."""
    names = set()
    d = paths["review_dir"]
    if os.path.isdir(d):
        for f in os.listdir(d):
            names.add(os.path.splitext(f)[0].lower())
    return names


def resolve_filename(product):
    """
    Determina il NOME FILE finale (solo il nome, senza cartella), rispettando
    il campo 'foto'. Se 'foto' contiene un percorso, ne prende solo il basename.
    Se 'foto' e' assente -> slug da nome + designer principale + azienda.
    """
    foto = (product.get("foto") or "").strip()
    if foto:
        # prendi solo il nome file, ignorando eventuali cartelle nel campo
        return os.path.basename(foto.replace("\\", "/"))
    # slug fallback: nome + designer principale + azienda
    base = "_".join(
        slugify(x) for x in [
            product.get("nome", ""),
            principal_designer(product.get("designer", "")),
            product.get("azienda", ""),
        ] if x
    )
    return f"{base}.jpg"


def build_queries(product):
    """
    Query ordinate per affidabilita': prima nome+designer+produttore, poi
    eventuale produttore attuale. Evita query troppo "creative" che spesso
    tirano dentro varianti strane.
    """
    nome = product.get("nome", "").strip()
    azienda = product.get("azienda", "").strip()
    azienda_attuale = (product.get("azienda_attuale") or "").strip()
    anno = str(product.get("anno", "")).strip()
    dp = principal_designer(product.get("designer", "")).strip()

    queries = []
    if nome and dp and azienda:
        queries.append(f'"{nome}" "{dp}" "{azienda}"')
    if azienda_attuale and azienda_attuale.lower() != azienda.lower() and nome and dp:
        queries.append(f'"{nome}" "{dp}" "{azienda_attuale}"')
    if nome and azienda:
        queries.append(f'"{nome}" "{azienda}"')
    if azienda_attuale and azienda_attuale.lower() != azienda.lower() and nome:
        queries.append(f'"{nome}" "{azienda_attuale}"')
    if nome and dp:
        queries.append(f'"{nome}" "{dp}"')
    if nome and azienda and anno:
        queries.append(f'"{nome}" "{azienda}" "{anno}"')
    if nome and azienda:
        queries.append(f'{nome} {azienda}')

    seen, out = set(), []
    for q in queries:
        q = " ".join(q.split())
        if q and q not in seen:
            seen.add(q)
            out.append(q)
    return out[:6]

def domain_of(url):
    try:
        return urlparse(url).netloc.lower().replace("www.", "")
    except Exception:
        return ""


def _norm_txt(value):
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _company_names(product):
    names = []
    for key in ("azienda", "azienda_attuale"):
        v = (product.get(key) or "").strip()
        if v and v.lower() not in {x.lower() for x in names}:
            names.append(v)
    return names


def source_score(cand, product):
    """
    Punteggio della fonte. Priorita' a produttori ufficiali, musei/archivi e
    fonti affidabili. Usa confronti normalizzati, quindi "Memphis Milano" e
    "memphis-milano.com" vengono riconosciuti come vicini.
    """
    page = cand.get("page_url") or ""
    img = cand.get("image_url") or ""
    dom = domain_of(page) or domain_of(img)
    sname = (cand.get("source_name") or "").lower()
    dom_norm = _norm_txt(dom)
    sname_norm = _norm_txt(sname)

    score = 0

    # 1) fonte = produttore del prodotto o produttore attuale? bonus forte.
    for azienda in _company_names(product):
        az_norm = _norm_txt(azienda)
        if az_norm and (az_norm in sname_norm or az_norm in dom_norm):
            score += 8
            break

    # 2) domini/nomi ufficiali noti: bonus medio.
    for good in PREFERRED_DOMAINS:
        good_norm = _norm_txt(good)
        stem_norm = _norm_txt(good.split(".")[0])
        if good in dom or good_norm in dom_norm or stem_norm in dom_norm or stem_norm in sname_norm:
            score += 4
            break

    # 3) fonti penalizzate.
    for bad in PENALIZED_DOMAINS:
        if bad in dom or _norm_txt(bad.strip(".")) in sname_norm:
            score -= 5
            break

    return score, dom

def text_coherence(candidate, product):
    """Quanti tra nome/designer/azienda compaiono nei testi del candidato."""
    hay = " ".join(str(candidate.get(k, "")) for k in
                    ("title", "source_name", "page_url", "image_url")).lower()
    hay_norm = _norm_txt(hay)
    nome = (product.get("nome") or "").lower()
    nome_norm = _norm_txt(nome)
    dp = principal_designer(product.get("designer", "")).lower()
    dp_norm = _norm_txt(dp)

    nome_hit = bool(nome_norm) and nome_norm in hay_norm
    dp_hit = bool(dp_norm) and dp_norm in hay_norm
    az_hit = False
    for azienda in _company_names(product):
        az_norm = _norm_txt(azienda)
        if az_norm and az_norm in hay_norm:
            az_hit = True
            break
    hits = sum([nome_hit, az_hit, dp_hit])
    return hits, nome_hit, az_hit, dp_hit

# --------------------------------------------------------------------------- #
# SerpApi (REST) - Google Images
# --------------------------------------------------------------------------- #

def searchapi_google_images(query, api_key):
    """
    Interroga SearchApi (engine google_images) e ritorna una lista di candidati
    'appiattiti' con chiavi uniformi: image_url, page_url, source_name, title,
    width, height, has_original.
    """
    params = {
        "engine": "google_images",
        "q": query,
        "api_key": api_key,
        "hl": "it",
        "gl": "it",
    }
    last_err = None
    for attempt in range(1, SERP_RETRIES + 1):
        try:
            r = requests.get(SEARCHAPI_ENDPOINT, params=params, timeout=REQUEST_TIMEOUT)
            if r.status_code == 200:
                data = r.json()
                raw = data.get("images", []) or []
                flat = []
                for pos, it in enumerate(raw, 1):
                    original = it.get("original") or {}
                    source = it.get("source") or {}
                    # 'original' e' un dict {link,width,height}; thumbnail e' una stringa
                    if isinstance(original, dict):
                        img_url = original.get("link", "")
                        w = original.get("width") or 0
                        h = original.get("height") or 0
                        has_original = bool(img_url)
                    else:
                        img_url = ""
                        w = h = 0
                        has_original = False
                    if not img_url:
                        img_url = it.get("thumbnail", "")
                    page_url = source.get("link", "") if isinstance(source, dict) else ""
                    source_name = source.get("name", "") if isinstance(source, dict) else ""
                    flat.append({
                        "image_url": img_url,
                        "page_url": page_url,
                        "source_name": source_name,
                        "title": it.get("title", ""),
                        "width": w,
                        "height": h,
                        "has_original": has_original,
                        "serp_position": pos,
                    })
                return flat
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
        time.sleep(SLEEP_BETWEEN * attempt)
    raise RuntimeError(f"SearchApi fallita per query={query!r}: {last_err}")


def rank_candidates(images_results, product):
    """
    Ordina i candidati in modo conservativo: il ranking Google/SearchApi conta
    molto, poi vengono fonte ufficiale e coerenza testuale. La facilita' di
    scontorno conta poco, perche' non deve far vincere una variante sbagliata.
    """
    scored = []
    for cand in images_results:
        page = cand.get("page_url") or ""
        img = cand.get("image_url") or ""
        if not img:
            continue
        s_score, dom = source_score(cand, product)
        hits, nome_hit, az_hit, dp_hit = text_coherence(cand, product)

        title_low = (cand.get("title") or "").lower()
        nome_low = (product.get("nome") or "").lower()
        hay_low = " ".join(str(cand.get(k, "")) for k in
                           ("title", "source_name", "page_url", "image_url")).lower()

        variant_penalty = 0
        # Parole che quasi sempre indicano variante, modello, replica o contenuto non-prodotto.
        hard_bad = (
            "miniatura", "miniature", "modellino", "scale model", "puzzle",
            "poster", "drawing", "sketch", "disegno", "dwg", "3d model",
            "replica", "inspired", "style", "auction lot", "lot ",
        )
        for kw in hard_bad:
            if kw in title_low and kw not in nome_low:
                variant_penalty -= 8
                break
        # Varianti commerciali/edizioni: penalita' leggera, non esclusione.
        soft_variant = ("limited edition", "special edition", "custom", "prototype")
        if any(kw in hay_low for kw in soft_variant):
            variant_penalty -= 3

        has_original = bool(cand.get("has_original"))
        w = cand.get("width") or 0
        h = cand.get("height") or 0
        small = (w and w < 450) or (h and h < 450)

        # Bonus tecnico molto contenuto: non deve superare il ranking/canonicalita'.
        technical_bonus = 0
        if w and h:
            long_side = max(w, h)
            ratio = max(w, h) / max(1, min(w, h))
            if long_side >= 1000:
                technical_bonus += 1
            if ratio <= 1.7:
                technical_bonus += 1
            elif ratio >= 2.8:
                technical_bonus -= 2

        serp_pos = cand.get("serp_position") or 99
        # Forte nei primi risultati, poi decade. E' la proxy migliore della versione famosa/canonica.
        serp_bonus = max(0, 16 - min(serp_pos, 16)) * 1.5

        total = (
            serp_bonus
            + s_score * 2.5
            + hits * 4
            + (1 if has_original else -1)
            + (-3 if small else 0)
            + technical_bonus
            + variant_penalty
        )

        if s_score >= 4 and nome_hit and (az_hit or dp_hit):
            conf = "alta"
        elif hits >= 2 or (s_score >= 4 and hits >= 1):
            conf = "media"
        elif hits >= 1:
            conf = "bassa"
        else:
            conf = "da_verificare"

        scored.append({
            "image_url": img,
            "source_page": page,
            "source_domain": dom,
            "source_name": cand.get("source_name", ""),
            "confidence": conf,
            "score": round(total, 2),
            "title": cand.get("title", ""),
            "has_original": has_original,
            "w": w, "h": h,
            "serp_position": serp_pos,
        })

    scored.sort(key=lambda c: (c["score"], -min(c.get("serp_position") or 99, 99)), reverse=True)
    return scored

# --------------------------------------------------------------------------- #
# Download
# --------------------------------------------------------------------------- #

def download_image(url):
    """Ritorna (bytes, ext) oppure solleva eccezione."""
    headers = {"User-Agent": "Mozilla/5.0 (compatible; ImageFetcher/1.0)"}
    last_err = None
    for attempt in range(1, DOWNLOAD_RETRIES + 1):
        try:
            r = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT, stream=True)
            ctype = r.headers.get("Content-Type", "").lower()
            if r.status_code != 200:
                last_err = f"HTTP {r.status_code}"
                continue
            if "image" not in ctype:
                # a volte il content-type e' generico: verifichiamo con Pillow dopo
                pass
            content = r.content
            if not content or len(content) < 1024:
                last_err = "file vuoto o troppo piccolo"
                continue
            # valida con Pillow
            try:
                im = Image.open(io.BytesIO(content))
                im.verify()
            except Exception as exc:  # noqa: BLE001
                last_err = f"non e' un'immagine valida ({exc})"
                continue
            ext = os.path.splitext(urlparse(url).path)[1].lower()
            if ext not in IMG_EXTS:
                # deduci da content-type
                if "png" in ctype:
                    ext = ".png"
                elif "webp" in ctype:
                    ext = ".webp"
                else:
                    ext = ".jpg"
            return content, ext
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
        time.sleep(SLEEP_BETWEEN * attempt)
    raise RuntimeError(f"download fallito: {last_err}")


# --------------------------------------------------------------------------- #
# Standardizzazione (white-threshold + flood fill, niente rembg)
# --------------------------------------------------------------------------- #

def looks_white_background(im):
    """Stima se l'immagine e' gia' su sfondo bianco guardando i bordi."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    border = []
    step = max(1, min(w, h) // 200)
    for x in range(0, w, step):
        border.append(px[x, 0])
        border.append(px[x, h - 1])
    for y in range(0, h, step):
        border.append(px[0, y])
        border.append(px[w - 1, y])
    if not border:
        return False
    whites = sum(1 for (r, g, b) in border
                 if r >= WHITE_THRESHOLD and g >= WHITE_THRESHOLD and b >= WHITE_THRESHOLD)
    return whites / len(border) >= BORDER_WHITE_FRACTION


def flood_fill_background_to_white(im):
    """
    Flood fill dai 4 angoli sostituendo i pixel 'quasi bianchi' connessi
    con bianco puro. Rimuove aloni/leggere texture di sfondo SENZA toccare
    il prodotto (che non e' connesso al bordo se lo sfondo e' chiaro).
    Ritorna (immagine_rgb, ok_bool).
    """
    rgb = im.convert("RGB")
    w, h = rgb.size
    px = rgb.load()

    visited = bytearray(w * h)
    q = deque()
    for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        q.append(corner)

    def is_bg(r, g, b):
        return r >= WHITE_THRESHOLD and g >= WHITE_THRESHOLD and b >= WHITE_THRESHOLD

    filled = 0
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        idx = y * w + x
        if visited[idx]:
            continue
        visited[idx] = 1
        r, g, b = px[x, y]
        if not is_bg(r, g, b):
            continue
        px[x, y] = (255, 255, 255)
        filled += 1
        q.append((x + 1, y))
        q.append((x - 1, y))
        q.append((x, y + 1))
        q.append((x, y - 1))

    # se abbiamo riempito pochissimo, lo sfondo non era neutralizzabile cosi'
    ok = filled > (w * h * 0.02)
    return rgb, ok


def content_bbox_on_white(im):
    """Bounding box del prodotto rispetto al bianco."""
    rgb = im.convert("RGB")
    bg = Image.new("RGB", rgb.size, (255, 255, 255))
    diff = ImageChops.difference(rgb, bg).convert("L")
    # binarizza: tutto cio' che si discosta dal bianco e' contenuto
    diff = diff.point(lambda p: 255 if p > (255 - WHITE_THRESHOLD + 5) else 0)
    return diff.getbbox()


def is_well_framed_on_white(im, bbox):
    """
    True se l'immagine sembra gia' una foto prodotto pronta: sfondo bianco,
    canvas quasi quadrato, soggetto centrato con margini sufficienti. In questo
    caso NON croppiamo il soggetto: ridimensioniamo l'intera immagine.
    """
    if not bbox:
        return False
    w, h = im.size
    if w <= 0 or h <= 0:
        return False
    canvas_ratio = max(w, h) / min(w, h)
    if canvas_ratio > 1.18:
        return False
    left, top, right, bottom = bbox
    bw, bh = right - left, bottom - top
    fill = max(bw / w, bh / h)
    margins = [left / w, top / h, (w - right) / w, (h - bottom) / h]
    # Target largo ma non aggressivo: se il risultato e' gia' da catalogo, preservalo.
    return 0.42 <= fill <= 0.86 and min(margins) >= 0.06


def whole_image_on_square_canvas(im):
    """Inserisce l'intera immagine su canvas quadrato bianco senza croppare."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    scale = min(FINAL_SIZE / w, FINAL_SIZE / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    resized = rgb.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGB", (FINAL_SIZE, FINAL_SIZE), (255, 255, 255))
    canvas.paste(resized, ((FINAL_SIZE - nw) // 2, (FINAL_SIZE - nh) // 2))
    return canvas

def save_jpeg_capped(image, path):
    """
    Salva JPEG puntando a ~TARGET_KB e senza superare MAX_KB.
    Strategia: abbassa la qualita' fino a JPEG_Q_MIN; se ancora troppo pesante,
    riduce progressivamente il lato del canvas. Ritorna (kb_finale, q_finale, size).
    """
    im = image
    max_bytes = MAX_KB * 1024
    target_bytes = TARGET_KB * 1024

    while True:
        chosen = None
        # scendi di qualita' finche' non rientri nel target (o nel tetto)
        for q in range(JPEG_Q_START, JPEG_Q_MIN - 1, -5):
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
            size = buf.tell()
            if chosen is None:
                chosen = (q, buf.getvalue(), size)  # fallback: la migliore vista finora
            if size <= target_bytes:
                chosen = (q, buf.getvalue(), size)
                break
            if size <= max_bytes:
                chosen = (q, buf.getvalue(), size)  # accettabile, ma continua a cercare target
        q, data, size = chosen
        if size <= max_bytes or im.width <= 500:
            with open(path, "wb") as fh:
                fh.write(data)
            return round(size / 1024, 1), q, im.size
        # ancora oltre il tetto: rimpicciolisci il canvas del 15% e riprova
        new_side = int(im.width * 0.85)
        im = im.resize((new_side, new_side), Image.LANCZOS)


_rembg_session = None
_rembg_available = None


def _get_rembg():
    """
    Carica rembg una sola volta (lazy). Ritorna la funzione remove oppure None
    se rembg non e' installato. Cosi' lo script funziona anche senza rembg,
    ripiegando sul flood-fill.
    """
    global _rembg_session, _rembg_available
    if _rembg_available is None:
        try:
            from rembg import remove, new_session
            _rembg_session = new_session("u2net")  # modello generico
            _rembg_available = True
        except Exception:  # noqa: BLE001
            _rembg_available = False
    return _rembg_available


def clean_alpha(alpha):
    """
    Pulisce la maschera alpha di rembg per togliere l'alone:
      1) soglia: bordo sfumato -> netto (soggetto pieno o sfondo)
      2) erosione: mangia il primissimo giro di bordo (contaminato dal vecchio sfondo)
      3) micro-sfumatura: evita il bordo seghettato senza reintrodurre alone
    Ritorna la nuova alpha (immagine 'L').
    """
    from PIL import ImageFilter
    # 1) soglia netta
    a = alpha.point(lambda p: 255 if p >= ALPHA_THRESHOLD else 0)
    # 2) erosione: MinFilter riduce le aree chiare (il soggetto) di ~1px per raggio
    if ALPHA_ERODE_PX > 0:
        size = ALPHA_ERODE_PX * 2 + 1  # kernel dispari (3 = 1px)
        a = a.filter(ImageFilter.MinFilter(size))
    # 3) micro blur per ammorbidire la scaletta del bordo
    if ALPHA_FEATHER > 0:
        a = a.filter(ImageFilter.GaussianBlur(ALPHA_FEATHER))
    return a


def cutout_on_white(content):
    """
    Scontorna il soggetto con rembg e lo rimette su bianco puro.
    Ritorna (immagine_RGB_su_bianco, bbox_soggetto, quality) dove quality e' un
    punteggio 0-100 di quanto e' venuto bene lo scontorno. (None, None, 0) se
    rembg non e' disponibile o non trova un soggetto affidabile.
    """
    if not _get_rembg():
        return None, None, 0
    try:
        from rembg import remove
        src = Image.open(io.BytesIO(content)).convert("RGBA")
        cut = remove(src, session=_rembg_session)  # RGBA con alpha
        # pulisci la maschera per togliere l'alone (soglia + erosione + micro blur)
        raw_alpha = cut.split()[-1]
        cleaned = clean_alpha(raw_alpha)
        cut.putalpha(cleaned)
        alpha = cleaned
        bbox = alpha.getbbox()
        if not bbox:
            return None, None, 0
        w, h = cut.size
        area_frac = ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) / (w * h)
        if area_frac < 0.01:
            return None, None, 0

        # --- FASE B: giudica la qualita' dello scontorno ---
        quality = 100
        motivi = []

        # 1) area del soggetto: ne' troppo piccola ne' che riempie tutto
        if area_frac < 0.05:
            quality -= 40; motivi.append("soggetto minuscolo (rembg ha mangiato?)")
        elif area_frac < 0.12:
            quality -= 15
        if area_frac > 0.97:
            quality -= 30; motivi.append("rembg non ha rimosso quasi nulla")

        # 2) bordo dell'alpha: molti pixel semi-trasparenti = bordo sporco/alone
        hist = alpha.histogram()
        total_px = w * h
        opaque = hist[255]
        transparent = hist[0]
        fuzzy = total_px - opaque - transparent  # semi-trasparenti
        subject_px = total_px - transparent
        if subject_px > 0:
            fuzzy_frac = fuzzy / subject_px
            if fuzzy_frac > 0.35:
                quality -= 30; motivi.append("bordo molto frastagliato/alone")
            elif fuzzy_frac > 0.20:
                quality -= 12

        # 3) soggetto che tocca i bordi = probabilmente tagliato
        touches = 0
        if bbox[0] <= 1: touches += 1
        if bbox[1] <= 1: touches += 1
        if bbox[2] >= w - 1: touches += 1
        if bbox[3] >= h - 1: touches += 1
        if touches >= 2:
            quality -= 20; motivi.append("soggetto a filo dei bordi (rischio taglio)")
        elif touches == 1:
            quality -= 8

        quality = max(0, min(100, quality))

        # componi su bianco puro
        white = Image.new("RGBA", cut.size, (255, 255, 255, 255))
        white.paste(cut, (0, 0), cut)
        result = white.convert("RGB")
        result.info["cutout_motivi"] = "; ".join(motivi)
        return result, bbox, quality
    except Exception:  # noqa: BLE001
        return None, None, 0


def standardize(content, want_white_removal=True):
    """
    Porta l'immagine su canvas quadrato bianco con padding.

    Regola nuova: se l'immagine e' gia' su bianco pulito, NON passa da rembg.
    Se e' anche gia' ben inquadrata, preserva l'intero canvas originale invece
    di croppare il prodotto. Questo evita tagli aggressivi e mantiene la prima
    immagine Google quando e' gia' quella giusta.
    """
    info = {
        "background_standardized": False,
        "padding_standardized": False,
        "needs_review": False,
        "reason": "",
        "method": "",
        "cutout_quality": None,
    }

    im = Image.open(io.BytesIO(content)).convert("RGB")

    # 1) Se e' gia' su bianco, non scontornare. E' il caso ideale.
    if looks_white_background(im):
        bbox = content_bbox_on_white(im)
        info["background_standardized"] = True
        info["method"] = "gia_bianco"
        info["cutout_quality"] = 95
        if is_well_framed_on_white(im, bbox):
            canvas = whole_image_on_square_canvas(im)
            info["padding_standardized"] = True
            info["method"] = "gia_bianco_preservato"
            return canvas, info
    else:
        bbox = None
        # 2) Se non e' su bianco, prova rembg solo ora.
        if want_white_removal:
            cut_im, cut_bbox, cut_quality = cutout_on_white(content)
            if cut_im is not None:
                im = cut_im
                bbox = cut_bbox
                info["background_standardized"] = True
                info["method"] = "rembg"
                info["cutout_quality"] = cut_quality
                if cut_quality < CUTOUT_QUALITY_MIN:
                    info["needs_review"] = True
                    motivi = cut_im.info.get("cutout_motivi", "")
                    info["reason"] = (f"scontorno incerto (qualita' {cut_quality}/100"
                                      + (f": {motivi}" if motivi else "") + ")")
            else:
                im, ok = flood_fill_background_to_white(im)
                if ok:
                    info["background_standardized"] = True
                    info["method"] = "flood_fill"
                    info["cutout_quality"] = 60
                else:
                    info["needs_review"] = True
                    info["reason"] = "sfondo non bianco e rembg non disponibile: da controllare"
                    info["method"] = "nessuno"
                    info["cutout_quality"] = 25
                bbox = content_bbox_on_white(im)
        else:
            info["method"] = "nessuno"
            bbox = content_bbox_on_white(im)

    if bbox is None:
        bbox = content_bbox_on_white(im)

    if not bbox:
        info["needs_review"] = True
        info["reason"] = info["reason"] or "impossibile isolare il prodotto"
        bbox = (0, 0, im.width, im.height)

    product = im.crop(bbox)
    pw, ph = product.size
    if pw == 0 or ph == 0:
        info["needs_review"] = True
        info["reason"] = info["reason"] or "prodotto vuoto dopo il crop"
        product = im
        pw, ph = product.size

    usable = FINAL_SIZE * TARGET_FILL
    scale = min(usable / pw, usable / ph)
    new_w = max(1, int(pw * scale))
    new_h = max(1, int(ph * scale))
    product = product.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGB", (FINAL_SIZE, FINAL_SIZE), (255, 255, 255))
    off_x = (FINAL_SIZE - new_w) // 2
    off_y = (FINAL_SIZE - new_h) // 2
    canvas.paste(product, (off_x, off_y))
    info["padding_standardized"] = True

    margin_x = off_x / FINAL_SIZE
    margin_y = off_y / FINAL_SIZE
    if margin_x < SAFE_MARGIN_MIN or margin_y < SAFE_MARGIN_MIN:
        info["needs_review"] = True
        info["reason"] = info["reason"] or "margine insufficiente per crop circolare"

    return canvas, info

# --------------------------------------------------------------------------- #
# Manifest / output
# --------------------------------------------------------------------------- #

MANIFEST_COLUMNS = [
    "id", "nome", "designer", "azienda", "anno", "categoria",
    "foto_originale", "filename_finale", "original_downloaded",
    "final_standardized", "image_downloaded", "image_url", "source_page",
    "source_domain", "query_usata", "confidence", "motivo",
    "background_standardized", "padding_standardized", "final_canvas_size",
    "status",
]


def build_paths(root):
    """
    Costruisce la mappa dei percorsi a partire dalla radice del progetto.
      <root>/immagini/                -> immagini finali (sito)
      <root>/_pipeline/images_original
      <root>/_pipeline/review_images
      <root>/_pipeline/*.csv, *.json, *.txt
    """
    images_dir = os.path.join(root, IMAGES_DIR)
    pipeline = os.path.join(root, PIPELINE_DIR)
    paths = {
        "root": root,
        "images_dir": images_dir,
        "pipeline": pipeline,
        "originals_dir": os.path.join(pipeline, ORIGINALS_SUB),
        "review_dir": os.path.join(pipeline, REVIEW_SUB),
        "scarti_dir": os.path.join(pipeline, SCARTI_SUB),
        "rejected_json": os.path.join(pipeline, "scartati.json"),
        "review_urls_json": os.path.join(pipeline, "review_urls.json"),
        "manifest": os.path.join(pipeline, "manifest_images.csv"),
        "review": os.path.join(pipeline, "review_needed.csv"),
        "products_out": os.path.join(pipeline, "prodotti_with_images.json"),
        "log_errors": os.path.join(pipeline, "log_errors.txt"),
    }
    for d in (images_dir, pipeline, paths["originals_dir"],
              paths["review_dir"], paths["scarti_dir"]):
        os.makedirs(d, exist_ok=True)
    return paths


def write_csv(path, rows, columns):
    if HAS_PANDAS:
        pd.DataFrame(rows, columns=columns).to_csv(path, index=False)
    else:
        with open(path, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=columns)
            writer.writeheader()
            for row in rows:
                writer.writerow({c: row.get(c, "") for c in columns})


# --------------------------------------------------------------------------- #
# Processo per singolo prodotto
# --------------------------------------------------------------------------- #

def process_product(product, api_key, paths, rejected, review_names):
    filename_finale = resolve_filename(product)            # solo nome file
    final_path = os.path.join(paths["images_dir"], filename_finale)
    base_no_ext = os.path.splitext(filename_finale)[0]
    base_key = base_no_ext.lower()

    row = {
        "id": product.get("id", ""),
        "nome": product.get("nome", ""),
        "designer": all_designers_str(product.get("designer", "")),
        "azienda": product.get("azienda", ""),
        "anno": product.get("anno", ""),
        "categoria": product.get("categoria", ""),
        "foto_originale": product.get("foto", ""),
        "filename_finale": filename_finale,
        "original_downloaded": False,
        "final_standardized": False,
        "image_downloaded": False,
        "image_url": "",
        "source_page": "",
        "source_domain": "",
        "query_usata": "",
        "confidence": "",
        "motivo": "",
        "background_standardized": False,
        "padding_standardized": False,
        "final_canvas_size": f"{FINAL_SIZE}x{FINAL_SIZE}",
        "status": "",
    }

    if _already_present(paths["images_dir"], base_no_ext):
        row["status"] = "already_exists"
        row["final_standardized"] = True
        row["motivo"] = "gia' nel sito (public/immagini): saltato, nessun credito usato"
        return row, None
    if base_key in review_names:
        row["status"] = "already_exists"
        row["motivo"] = "gia' in review_images (in attesa di giudizio): saltato"
        return row, None

    bad_urls = rejected.get(base_key, set())

    queries = build_queries(product)
    candidates = []
    used_query = ""
    for q in queries:
        try:
            results = searchapi_google_images(q, api_key)
        except Exception as exc:  # noqa: BLE001
            log_error(paths, f"{product.get('nome','?')}: {exc}")
            continue
        ranked = rank_candidates(results, product)
        ranked = [c for c in ranked if c["image_url"] not in bad_urls]
        if ranked:
            candidates = ranked
            used_query = q
            # se la prima query produce un candidato alto, non andare a cercare query piu' generiche.
            if ranked[0]["confidence"] == "alta":
                break
        time.sleep(SLEEP_BETWEEN)

    row["query_usata"] = used_query

    if not candidates:
        row["status"] = "not_found"
        row["confidence"] = "da_verificare"
        row["motivo"] = ("nessun candidato nuovo dalla ricerca"
                         if bad_urls else "nessun candidato dalla ricerca")
        return row, "review"

    best = candidates[0]
    row["image_url"] = best["image_url"]
    row["source_page"] = best["source_page"]
    row["source_domain"] = best["source_domain"]
    row["confidence"] = best["confidence"]

    # Nuova logica: prova i candidati in ordine di ranking. Accetta il primo
    # visivamente valido. NON scegliere un'immagine sbagliata solo perche' rembg
    # l'ha scontornata meglio.
    MAX_TRY = 5
    fallback_result = None   # (choice_score, final_im, info, content, ext, cand)

    for cand in candidates[:MAX_TRY]:
        try:
            content, ext = download_image(cand["image_url"])
        except Exception as exc:  # noqa: BLE001
            log_error(paths, f"{product.get('nome','?')} download: {exc}")
            continue
        try:
            final_im, info = standardize(content, want_white_removal=True)
        except Exception as exc:  # noqa: BLE001
            log_error(paths, f"{product.get('nome','?')} standardize: {exc}")
            continue

        q = info.get("cutout_quality")
        q = q if q is not None else 50
        method = info.get("method", "")

        # Score di ripiego: ranking/canonicalita' + piccolo bonus visuale.
        # Candidati gia' su bianco pulito vincono nettamente.
        visual_bonus = 0
        if method.startswith("gia_bianco"):
            visual_bonus += 20
        elif method == "flood_fill":
            visual_bonus += 8
        elif method == "rembg":
            visual_bonus += max(0, min(q, 100)) / 10
        if info["needs_review"]:
            visual_bonus -= 15
        choice_score = cand.get("score", 0) + visual_bonus

        if fallback_result is None or choice_score > fallback_result[0]:
            fallback_result = (choice_score, final_im, info, content, ext, cand)

        # Caso ideale: immagine gia' bianca/canonica. Fermati subito.
        if method.startswith("gia_bianco") and not info["needs_review"]:
            fallback_result = (choice_score, final_im, info, content, ext, cand)
            break

        # Candidato semanticamente alto e visualmente accettabile: fermati.
        if cand["confidence"] in ("alta", "media") and not info["needs_review"]:
            fallback_result = (choice_score, final_im, info, content, ext, cand)
            break

    if fallback_result is None:
        row["status"] = "download_failed"
        row["motivo"] = "tutti i download/scontorni falliti"
        return row, "review"

    _choice_score, final_im, info, content, ext, cand = fallback_result
    quality = info.get("cutout_quality")
    quality = quality if quality is not None else 50

    row["image_downloaded"] = True
    row["image_url"] = cand["image_url"]
    row["source_page"] = cand["source_page"]
    row["source_domain"] = cand["source_domain"]
    row["confidence"] = cand["confidence"]
    row["background_standardized"] = info["background_standardized"]
    row["padding_standardized"] = info["padding_standardized"]

    orig_path = os.path.join(paths["originals_dir"], base_no_ext + ext)
    try:
        with open(orig_path, "wb") as fh:
            fh.write(content)
        row["original_downloaded"] = True
    except Exception as exc:  # noqa: BLE001
        log_error(paths, f"{product.get('nome','?')} save original: {exc}")

    review_path = os.path.join(paths["review_dir"], base_no_ext + ".jpg")
    kb, _q, size = save_jpeg_capped(final_im, review_path)
    row["final_canvas_size"] = f"{size[0]}x{size[1]}"
    row["status"] = "review_needed"
    record_review_url(paths, base_no_ext, cand["image_url"])

    method = info.get("method", "")
    qtxt = f"metodo {method}, qualita' {quality}/100"
    if info["needs_review"]:
        row["motivo"] = f"{info['reason'] or 'da controllare'} | conf: {cand['confidence']} | {qtxt}"
    else:
        row["motivo"] = f"pronta ({qtxt}, conf: {cand['confidence']}, rank Google {cand.get('serp_position','?')}) - da approvare"
    return row, "review"

# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main():
    parser = argparse.ArgumentParser(description="Scarica e standardizza immagini prodotti.")
    parser.add_argument("--input", default="src/data/prodotti.json",
                        help="file JSON di input (default: src/data/prodotti.json)")
    parser.add_argument("--root", default=".",
                        help="radice del progetto: dentro crea 'immagini/' e '_pipeline/' "
                             "(default: cartella corrente)")
    parser.add_argument("--limit", type=int, default=20,
                        help="numero prodotti da processare (test iniziale)")
    parser.add_argument("--all", action="store_true",
                        help="processa tutto il database (ignora --limit)")
    parser.add_argument("--zip", action="store_true",
                        help="crea _pipeline/immagini_final.zip alla fine")
    parser.add_argument("--only", default="",
                        help="processa solo i prodotti che contengono questa stringa in nome/designer/azienda/foto")
    args = parser.parse_args()

    api_key = (os.environ.get("SEARCHAPI_KEY", "")
               or os.environ.get("SERPAPI_KEY", "")).strip()
    if not api_key:
        print("ERRORE: imposta la variabile d'ambiente SEARCHAPI_KEY.", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.input):
        print(f"ERRORE: file non trovato: {args.input}", file=sys.stderr)
        sys.exit(1)

    with open(args.input, "r", encoding="utf-8") as fh:
        products = json.load(fh)
    if not isinstance(products, list):
        print("ERRORE: il JSON deve essere una lista di prodotti.", file=sys.stderr)
        sys.exit(1)

    if args.only:
        needle = args.only.lower().strip()
        def searchable(p):
            return " ".join([
                str(p.get("nome", "")),
                all_designers_str(p.get("designer", "")),
                str(p.get("azienda", "")),
                str(p.get("azienda_attuale", "")),
                str(p.get("foto", "")),
            ]).lower()
        products = [p for p in products if needle in searchable(p)]
        if not products:
            print(f"ERRORE: nessun prodotto trovato per --only {args.only!r}.", file=sys.stderr)
            sys.exit(1)

    paths = build_paths(args.root)

    # memoria degli scarti (URL bocciati) e nomi gia' in review: letti PRIMA
    # di sovrascrivere il manifest, cosi' riflettono la run precedente.
    rejected = load_rejections(paths)
    review_names = in_review_basenames(paths)
    n_rejected = sum(len(v) for v in rejected.values())
    if n_rejected:
        print(f"Memoria scarti: {n_rejected} URL bocciati su "
              f"{len(rejected)} prodotti verranno evitati.")

    # reset log
    open(paths["log_errors"], "w", encoding="utf-8").close()

    subset = products if (args.all or args.only) else products[:args.limit]

    manifest_rows = []
    review_rows = []
    products_out = []

    counts = {
        "downloaded": 0, "already_exists": 0, "review_needed": 0,
        "not_found": 0, "download_failed": 0, "standardization_failed": 0,
    }
    successes, doubtful = [], []

    for i, product in enumerate(subset, 1):
        name = product.get("nome", f"#{i}")
        print(f"[{i}/{len(subset)}] {name} ...", flush=True)
        row, flag = process_product(product, api_key, paths, rejected, review_names)
        manifest_rows.append(row)
        counts[row["status"]] = counts.get(row["status"], 0) + 1

        # se e' finita in review in questa run, aggiorna il set cosi' un eventuale
        # duplicato nello stesso JSON viene saltato (niente doppio download)
        if row["status"] == "review_needed":
            review_names.add(os.path.splitext(row["filename_finale"])[0].lower())

        if flag == "review":
            review_rows.append(row)
        if row["status"] == "review_needed" and len(successes) < 5:
            successes.append(row)
        if row["status"] in ("not_found", "download_failed") and len(doubtful) < 5:
            doubtful.append(row)

        # arricchisci il prodotto (senza cancellare campi originali)
        enriched = dict(product)
        enriched.update({
            "image_downloaded": row["image_downloaded"],
            "image_filename": row["filename_finale"],
            "image_original_filename": os.path.basename(row["filename_finale"]),
            "image_url": row["image_url"],
            "image_source_page": row["source_page"],
            "image_source_domain": row["source_domain"],
            "image_confidence": row["confidence"],
            "image_status": row["status"],
            "image_notes": row["motivo"],
            "image_background_standardized": row["background_standardized"],
            "image_padding_standardized": row["padding_standardized"],
            "image_canvas_size": row["final_canvas_size"],
        })
        products_out.append(enriched)

    # scrivi output
    write_csv(paths["manifest"], manifest_rows, MANIFEST_COLUMNS)
    write_csv(paths["review"], review_rows, MANIFEST_COLUMNS)
    with open(paths["products_out"], "w", encoding="utf-8") as fh:
        json.dump(products_out, fh, ensure_ascii=False, indent=2)

    # zip delle sole immagini finali (dentro _pipeline, non nel sito)
    if args.zip:
        zip_path = os.path.join(paths["pipeline"], "immagini_final.zip")
        img_dir = paths["images_dir"]
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for r_, _dirs, files in os.walk(img_dir):
                for f in files:
                    full = os.path.join(r_, f)
                    arc = os.path.relpath(full, img_dir)
                    zf.write(full, arc)

    # riepilogo
    prep = counts.get("review_needed", 0)
    print("\n===== RIEPILOGO =====")
    print(f"Prodotti processati:            {len(subset)}")
    print(f"Pronte in review (da approvare):{prep}")
    print(f"Saltate (gia' fatte):           {counts.get('already_exists', 0)}")
    print(f"Nessuna immagine trovata:       {counts.get('not_found', 0)}")
    print(f"Errori (download/standardize):  {counts.get('download_failed', 0) + counts.get('standardization_failed', 0)}")
    print("")
    print(f">> CONTROLLA QUI le immagini:   {paths['review_dir']}")
    print(f"   Le BUONE -> spostale in:     {paths['images_dir']}")
    print(f"   Le SCARTE -> spostale in:    {paths['scarti_dir']}")
    print(f"   Report e log:                {paths['pipeline']}")

    print("\n--- 5 esempi pronti in review ---")
    for r in successes:
        print(f"  {r['nome']} -> {r['filename_finale']} | {r['source_domain']} | conf={r['confidence']}")
    print("\n--- 5 casi senza immagine / errore ---")
    for r in doubtful:
        print(f"  {r['nome']} -> {r['status']} | {r['motivo']}")


if __name__ == "__main__":
    main()
