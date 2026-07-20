#!/usr/bin/env python3
"""
download_product_images.py

Workflow completo per costruire una cartella di immagini standardizzate
(sfondo bianco, prodotto centrato, padding ampio, adatte a crop circolare)
a partire da un database JSON di prodotti di design.

Ricerca immagini: SearchApi.io (engine google_images) via REST API.
Standardizzazione: preserva l'immagine originale; niente rembg, niente crop, niente flood-fill automatico.

USO (dalla RADICE del progetto, es. design-network/):
    set SEARCHAPI_KEY=la_tua_chiave        (Windows)
    py download_product_images.py --limit 20

    # per processare tutto il database dopo il test:
    py download_product_images.py --all --zip

    Legge di default: src/data/prodotti.json
    Immagini buone salvate in:  immagini/           (visibili sul sito)
    Originali, dubbie, report:  _pipeline/

Dipendenze:
    pip install requests pandas Pillow

Note importanti:
    - Lo script NON reinventa immagini e NON scontorna: preserva la sorgente trovata.
    - Scarica automaticamente solo confidence alta/media.
    - Tutte le immagini finiscono in review_images/ per approvazione manuale.
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
CANDIDATE_REVIEW_SUB = "review_candidates"  # cartelle con piu candidati per prodotto
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
FINAL_SIZE = 1600            # px, quadrato; piu' dettaglio e meno compressione visibile
TARGET_FILL = 0.78           # usato solo per controlli/report; non croppiamo piu' il soggetto

# Qualita' finale JPEG: priorita' alla resa, non al peso minimo.
# Un'immagine bianca puo' pesare 40-80 KB anche a qualita' alta: non e' per forza compressa male.
TARGET_KB = 180              # indicativo per report; non forziamo il file a diventare pesante
MAX_KB = 450                 # tetto massimo ragionevole per il sito
JPEG_Q_START = 96            # qualita' alta
JPEG_Q_MIN = 88              # sotto questa qualita' riduciamo poco il canvas solo se necessario
SAFE_MARGIN_MIN = 0.08       # margine indicativo

# soglie per il rilevamento "sfondo bianco"
WHITE_THRESHOLD = 245        # un pixel e' "bianco" se R,G,B >= soglia
BORDER_WHITE_FRACTION = 0.92 # piu' severo: salta rembg solo se lo sfondo e' davvero pulito

# rete
REQUEST_TIMEOUT = 10
DOWNLOAD_RETRIES = 2
SERP_RETRIES = 1
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

SCRIPT_VERSION = "2026-07-20-download-product-images-final-candidates"
DEBUG_CANDIDATES = False
CANDIDATES_PER_PRODUCT = 2  # default: salva pochi candidati filtrati in review_images, non nel sito
RETRY_SCARTI = False  # se False, un prodotto con file in _pipeline/scarti viene saltato del tutto

# Qualita minima richiesta alla sorgente scaricata. Se la sorgente e' piu' piccola,
# la si usa solo come fallback, non come prima scelta.
MIN_SOURCE_LONG_SIDE = 900
MIN_SOURCE_SHORT_SIDE = 500
MIN_DOWNLOAD_BYTES_STRICT = 45 * 1024



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


def review_candidate_filename(base_no_ext, n):
    """Nome candidato: base.jpg, base2.jpg, base3.jpg..."""
    base = str(base_no_ext)
    return f"{base}.jpg" if int(n) == 1 else f"{base}{int(n)}.jpg"


def candidate_stems_for_base(base_no_ext, max_n=30):
    """Stem possibili dei candidati flat per un prodotto."""
    base = str(base_no_ext).lower()
    stems = {base}
    for n in range(2, max_n + 1):
        stems.add(f"{base}{n}")
    # compatibilita' con vecchi nomi usati nelle versioni precedenti
    for n in range(1, max_n + 1):
        stems.add(f"{base}__{n:02d}")
        stems.add(f"{base}__{n}")
    return stems


def is_review_file_for_base(filename, base_no_ext):
    """True se filename e' un candidato review per base_no_ext."""
    stem = os.path.splitext(os.path.basename(filename))[0].lower()
    base = str(base_no_ext).lower()
    if stem in candidate_stems_for_base(base):
        return True
    # vecchia modalita': 01__branzi-mies__pos2__dominio
    return bool(re.match(rf"^\d+__{re.escape(base)}__", stem))


def product_base_from_review_stem(stem, known_base_to_url=None, product_by_file=None):
    """Ricava il prodotto base da uno stem di review/scarti.

    Gestisce:
      - branzi-mies          -> branzi-mies
      - branzi-mies2         -> branzi-mies, solo se branzi-mies e' noto
      - branzi-mies__01      -> branzi-mies
      - 02__branzi-mies__pos -> branzi-mies
      - branzi-mies2_1       -> branzi-mies2 -> branzi-mies se noto
    """
    s = strip_scarto_suffix(str(stem).lower())
    product_by_file = product_by_file or {}
    if s in product_by_file:
        return str(product_by_file[s]).lower()

    m = re.match(r"^\d+__(.*?)__", s)
    if m:
        return m.group(1).lower()

    m = re.match(r"^(.*?)__\d+$", s)
    if m:
        return m.group(1).lower()

    # Nuova nomenclatura: base2/base3. La togliamo solo se il base e' noto,
    # per non rompere prodotti veri che finiscono con numeri, tipo 2097 o 4870.
    m = re.match(r"^(.*?)([2-9]|1\d|2\d|30)$", s)
    if m:
        maybe_base = m.group(1).lower()
        known = known_base_to_url or {}
        if maybe_base in known or maybe_base in set(str(v).lower() for v in product_by_file.values()):
            return maybe_base
    return s


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
    Costruisce la memoria degli scarti.

    Questa versione e' piu' robusta per il flusso review:
      - riconosce i candidati base.jpg, base2.jpg, base3.jpg;
      - riconosce anche i vecchi base__01.jpg e 01__base__pos...jpg;
      - legge review_urls.json e review_candidates_flat.csv per risalire
        all'URL preciso di ogni candidato spostato in _pipeline/scarti;
      - salva tutto in scartati.json, cosi' gli URL bocciati non vengono
        riproposti nelle run successive.
    Ritorna: dict { base_prodotto(lower) : set(url_scartati) }
    """
    scarti_dir = paths["scarti_dir"]

    # Manteniamo la rinumerazione per evitare conflitti di nomi in scarti/.
    # La logica sotto sa risalire da base2_1 -> base2 -> prodotto base.
    renumber_scarti(scarti_dir)

    rejected = {}
    if os.path.exists(paths["rejected_json"]):
        try:
            with open(paths["rejected_json"], "r", encoding="utf-8") as fh:
                rejected = {k: set(v) for k, v in json.load(fh).items()}
        except Exception:  # noqa: BLE001
            rejected = {}

    raw_map = {}
    product_by_file = {}
    pmap = paths["review_urls_json"]
    if os.path.exists(pmap):
        try:
            with open(pmap, "r", encoding="utf-8") as fh:
                raw_map = json.load(fh)
        except Exception:  # noqa: BLE001
            raw_map = {}

    if isinstance(raw_map.get("_product_base_by_file"), dict):
        product_by_file.update({str(k).lower(): str(v).lower()
                                for k, v in raw_map.get("_product_base_by_file", {}).items()})

    base_to_url = {}
    for k, v in raw_map.items():
        if k == "_product_base_by_file":
            continue
        key = str(k).lower()
        if isinstance(v, str):
            base_to_url[key] = v
        elif isinstance(v, dict):
            url = v.get("image_url") or v.get("url")
            page = v.get("source_page") or v.get("page_url")
            # Salviamo URL immagine come token principale; la pagina viene
            # aggiunta dopo alla memoria scarti se il file finisce in scarti.
            if url:
                base_to_url[key] = url
            elif page:
                base_to_url[key] = page
            pb = v.get("product_base")
            if pb:
                product_by_file[key] = str(pb).lower()

    # Indice globale dei candidati flat: fondamentale per vecchie run in cui
    # review_urls.json non aveva registrato base2/base3.
    index_path = os.path.join(paths["pipeline"], "review_candidates_flat.csv")
    if os.path.exists(index_path):
        try:
            with open(index_path, "r", encoding="utf-8", newline="") as fh:
                for r in csv.DictReader(fh):
                    fn = (r.get("file") or "").strip()
                    url = (r.get("image_url") or r.get("source_page") or "").strip()
                    if fn and url:
                        stem = os.path.splitext(os.path.basename(fn))[0].lower()
                        base_to_url.setdefault(stem, url)
        except Exception:  # noqa: BLE001
            pass

    # Ripiego vecchio manifest: meno preciso, ma meglio di niente.
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

    def lookup_url_for_stem(stem):
        s = str(stem).lower()
        keys = [s, strip_scarto_suffix(s)]
        # Se e' base2_1, strip_scarto_suffix -> base2: cerca anche base se noto.
        base_guess = product_base_from_review_stem(keys[-1], base_to_url, product_by_file)
        keys.append(base_guess)
        for key in keys:
            if key in base_to_url:
                return base_to_url[key], key
        return "", keys[-1]

    added_from_scarti = 0
    if os.path.isdir(scarti_dir):
        for f in os.listdir(scarti_dir):
            stem = os.path.splitext(f)[0].lower()
            url, matched_key = lookup_url_for_stem(stem)
            product_base = product_base_from_review_stem(matched_key, base_to_url, product_by_file)
            if url and product_base:
                before = len(rejected.setdefault(product_base, set()))
                rejected[product_base].add(url)
                if len(rejected[product_base]) > before:
                    added_from_scarti += 1

    try:
        with open(paths["rejected_json"], "w", encoding="utf-8") as fh:
            json.dump({k: sorted(v) for k, v in rejected.items()},
                      fh, ensure_ascii=False, indent=2)
    except Exception:  # noqa: BLE001
        pass

    if added_from_scarti:
        print(f"Scarti aggiornati: {added_from_scarti} URL aggiunti alla memoria da _pipeline/scarti.")

    return rejected

def record_review_url(paths, file_stem, url, product_base=None, source_page="", image_hash=""):
    """Registra URL, pagina sorgente e prodotto base di ogni candidato salvato.

    Serve quando sposti un file in _pipeline/scarti: alla run successiva lo
    script risale al candidato preciso, non solo al prodotto generico.
    """
    if not url and not source_page:
        return
    data = {}
    p = paths["review_urls_json"]
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:  # noqa: BLE001
            data = {}
    key = str(file_stem).lower()
    data[key] = {
        "image_url": url or "",
        "source_page": source_page or "",
        "product_base": str(product_base).lower() if product_base else key,
        "image_hash": str(image_hash or ""),
    }
    if product_base:
        data.setdefault("_product_base_by_file", {})[key] = str(product_base).lower()
    try:
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
    except Exception:  # noqa: BLE001
        pass


def image_ahash_from_image(im, size=16):
    """Hash percettivo semplice ma piu' stabile: 16x16 = 256 bit.

    Lo usiamo per evitare che un'immagine gia' spostata in _pipeline/scarti
    venga riproposta anche se l'URL cambia leggermente o se SearchApi la
    restituisce da una CDN diversa.
    """
    try:
        small = im.convert("L").resize((size, size), Image.Resampling.LANCZOS)
    except AttributeError:
        small = im.convert("L").resize((size, size), Image.LANCZOS)
    vals = list(small.getdata())
    avg = sum(vals) / len(vals)
    bits = 0
    for i, v in enumerate(vals):
        if v >= avg:
            bits |= (1 << i)
    return bits


def image_ahash_from_bytes(content):
    im = Image.open(io.BytesIO(content))
    return image_ahash_from_image(im)


def image_ahash_from_path(path):
    im = Image.open(path)
    return image_ahash_from_image(im)


def hamming_distance(a, b):
    return int(a ^ b).bit_count()


def normalize_url_for_rejection(url):
    """Normalizza un URL per confronti anti-scarto.

    Molte CDN aggiungono parametri di tracking/dimensione; qui li ignoriamo.
    Non e' perfetto, ma evita molti ripescaggi dello stesso file.
    """
    if not url:
        return ""
    try:
        u = urlparse(str(url).strip())
        host = (u.netloc or "").lower().replace("www.", "")
        path = re.sub(r"/+$", "", u.path or "")
        return f"{host}{path}".lower()
    except Exception:
        return str(url).strip().lower().split("?")[0].split("#")[0]


def url_is_rejected(url, rejected_tokens):
    """True se l'URL e' gia' stato bocciato, anche con querystring diversa."""
    if not url or not rejected_tokens:
        return False
    raw = str(url).strip()
    norm = normalize_url_for_rejection(raw)
    for old in rejected_tokens:
        old_s = str(old).strip()
        if not old_s:
            continue
        if raw == old_s or raw.lower() == old_s.lower():
            return True
        if norm and norm == normalize_url_for_rejection(old_s):
            return True
    return False


def candidate_is_rejected(cand, rejected_tokens):
    """Controlla image_url e source_page contro la memoria degli scarti."""
    if not rejected_tokens:
        return False
    return (
        url_is_rejected(cand.get("image_url", ""), rejected_tokens)
        or url_is_rejected(cand.get("source_page", ""), rejected_tokens)
    )


def all_rejected_tokens(rejected):
    """Unisce tutti gli URL/pagine bocciati, non solo quelli del prodotto corrente.

    Serve per evitare che la stessa immagine torni fuori se:
      - hai cambiato il nome file nel JSON;
      - un candidato era stato salvato come base2/base3;
      - lo stesso URL viene proposto per un prodotto simile.
    """
    out = set()
    for vals in (rejected or {}).values():
        try:
            out.update(vals)
        except TypeError:
            if vals:
                out.add(vals)
    return out


def load_scarti_hashes_for_base(paths, base_no_ext=None):
    """Legge gli hash percettivi degli scarti.

    IMPORTANTE: ora il controllo e' GLOBALE, non solo per nome prodotto.
    Quindi se hai scartato un file come lucchi-tolomeo.jpg e poi nel JSON lo
    rinomini in delucchi-tolomeo.jpg, quella stessa immagine viene comunque
    bloccata.

    base_no_ext resta come argomento solo per compatibilita' con le chiamate
    gia' presenti nel codice.
    """
    out = []
    d = paths.get("scarti_dir")
    if not d or not os.path.isdir(d):
        return out
    for f in os.listdir(d):
        ext = os.path.splitext(f)[1].lower()
        if ext not in IMG_EXTS:
            continue
        try:
            out.append(image_ahash_from_path(os.path.join(d, f)))
        except Exception:
            pass
    return out

def content_matches_scarti(content, scarti_hashes, threshold=26):
    """True se il contenuto scaricato corrisponde visivamente a uno scarto.

    Calcola due hash: uno sulla sorgente grezza e uno sulla stessa immagine dopo
    la standardizzazione no-crop. Questo intercetta il caso piu' comune: tu
    sposti in scarti il JPG generato, mentre SearchApi ripropone l'originale.
    """
    if not scarti_hashes:
        return False
    hashes = []
    try:
        hashes.append(image_ahash_from_bytes(content))
    except Exception:
        pass
    try:
        final_im, _info = standardize(content, want_white_removal=False)
        hashes.append(image_ahash_from_image(final_im))
    except Exception:
        pass
    for h in hashes:
        for old in scarti_hashes:
            try:
                if hamming_distance(h, old) <= threshold:
                    return True
            except Exception:
                pass
    return False

def in_review_basenames(paths):
    """Nomi base gia' presenti in review_images/ o review_candidates/."""
    names = set()
    d = paths["review_dir"]
    if os.path.isdir(d):
        for f in os.listdir(d):
            b = os.path.splitext(f)[0].lower()
            names.add(b)
            m = re.match(r"^(.*)__\d+$", b)
            if m:
                names.add(m.group(1))
            # nuova nomenclatura base2/base3: se esiste base.jpg nella stessa
            # cartella o nell'indice, la funzione process_product fa comunque
            # un controllo esatto con is_review_file_for_base.
    cand_dir = paths.get("candidate_review_dir")
    if cand_dir and os.path.isdir(cand_dir):
        for f in os.listdir(cand_dir):
            if os.path.isdir(os.path.join(cand_dir, f)):
                names.add(f.lower())
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


def _product_searchable_text(product):
    """Testo usato per --only / --inspect-json."""
    return " ".join([
        str(product.get("nome", "")),
        all_designers_str(product.get("designer", "")),
        str(product.get("azienda", "")),
        str(product.get("azienda_attuale", "")),
        str(product.get("foto", "")),
    ]).lower()



def review_contains_base(paths, base_no_ext):
    """True se in review_images/ o review_candidates/ esiste gia' qualcosa per questo prodotto.

    Gestisce sia la nuova nomenclatura base.jpg/base2.jpg/base3.jpg sia le vecchie
    base__01.jpg e 01__base__pos...jpg.
    """
    base = str(base_no_ext).lower()
    review_dir = paths.get("review_dir")
    if review_dir and os.path.isdir(review_dir):
        for f in os.listdir(review_dir):
            if is_review_file_for_base(f, base):
                return True
    cand_dir = paths.get("candidate_review_dir")
    if cand_dir and os.path.isdir(cand_dir):
        if os.path.isdir(os.path.join(cand_dir, base)):
            return True
    return False


def scarti_contains_base(paths, base_no_ext):
    """True se _pipeline/scarti contiene gia' candidati per questo prodotto.

    Questa e' la regola dura richiesta: se hai spostato in scarti una o piu'
    immagini di un prodotto, lo script non deve riproporle e, di default, non
    deve neanche riscaricare quel prodotto. Se vuoi forzare un nuovo tentativo,
    usa --retry-scarti.
    """
    base = str(base_no_ext).lower()
    d = paths.get("scarti_dir")
    if not d or not os.path.isdir(d):
        return False
    for f in os.listdir(d):
        ext = os.path.splitext(f)[1].lower()
        if ext not in IMG_EXTS:
            continue
        stem = os.path.splitext(f)[0].lower()
        stem_clean = strip_scarto_suffix(stem)
        if is_review_file_for_base(stem_clean + ext, base):
            return True
        if stem_clean == base:
            return True
        # vecchia modalita cartella/candidate: 01__base__pos...
        if re.match(rf"^\d+__{re.escape(base)}__", stem_clean):
            return True
    return False

def product_already_handled(product, paths, review_names=None):
    """True se il prodotto ha gia' immagine approvata o candidati in review.

    Usa il filename risolto dal JSON attuale. Quindi se cambi "foto" da
    lucchi-tolomeo.jpg a delucchi-tolomeo.jpg, cambia anche il controllo.
    """
    filename_finale = resolve_filename(product)
    base_no_ext = os.path.splitext(filename_finale)[0]
    if _already_present(paths["images_dir"], base_no_ext):
        return True
    if review_contains_base(paths, base_no_ext):
        return True
    if review_names and base_no_ext.lower() in review_names:
        return True
    if not RETRY_SCARTI and scarti_contains_base(paths, base_no_ext):
        return True
    return False


def inspect_json_products(products, needle):
    """Stampa i record JSON che matchano needle e il filename risolto."""
    n = (needle or "").lower().strip()
    matches = [p for p in products if n in _product_searchable_text(p)]
    if not matches:
        print(f"Nessun prodotto nel JSON contiene: {needle!r}")
        return 1
    print(f"Prodotti trovati nel JSON per {needle!r}: {len(matches)}")
    for i, p in enumerate(matches, 1):
        print("-" * 70)
        print(f"{i}. nome:     {p.get('nome', '')}")
        print(f"   designer: {all_designers_str(p.get('designer', ''))}")
        print(f"   azienda:  {p.get('azienda', '')}")
        print(f"   attuale:  {p.get('azienda_attuale', '')}")
        print(f"   foto:     {p.get('foto', '')}")
        print(f"   filename risolto dallo script: {resolve_filename(p)}")
    return 0



def company_domain_for(product):
    """Dominio ufficiale preferito per query site:, quando lo conosciamo."""
    names = [str(product.get("azienda", "")), str(product.get("azienda_attuale", ""))]
    norm_names = {_norm_txt(n) for n in names if n}
    mapping = {
        "cassina": "cassina.com",
        "flos": "flos.com",
        "zanotta": "zanotta.com",
        "artemide": "artemide.com",
        "kartell": "kartell.com",
        "alessi": "alessi.com",
        "vitram": "vitra.com",  # fallback safety
        "vitra": "vitra.com",
        "hermanmiller": "hermanmiller.com",
        "knoll": "knoll.com",
        "poltronova": "poltronova.it",
        "memphis": "memphis-milano.com",
        "memphismilano": "memphis-milano.com",
        "danese": "danesemilano.com",
        "danesemilano": "danesemilano.com",
        "oluce": "oluce.com",
        "oluce": "oluce.com",
        "martinelliluce": "martinelliluce.it",
        "bline": "b-line.it",
        "gufram": "gufram.it",
        "arflex": "arflex.com",
        "fiammitalia": "fiamitalia.it",
        "fiamitalia": "fiamitalia.it",
        "magis": "magisdesign.com",
        "driade": "driade.com",
        "tecnospa": "tecnospa.com",
        "tecno": "tecnospa.com",
        "cappellini": "cappellini.com",
        "bbitalia": "bebitalia.com",
        "bebitalia": "bebitalia.com",
        "depadova": "depadova.com",
        "molteni": "molteni.it",
        "fiamitalia": "fiamitalia.it",
        "fontanaarte": "fontanaarte.com",
        "olivari": "olivari.it",
    }
    for n in norm_names:
        if n in mapping:
            return mapping[n]
    return ""


def designer_surnames(product):
    d = product.get("designer", "")
    names = d if isinstance(d, list) else [d]
    out = []
    for name in names:
        parts = str(name or "").strip().split()
        if parts:
            out.append(parts[-1])
    return out


def product_aliases(product):
    """Frasi prodotto piu' precise del solo campo nome, soprattutto per nomi generici."""
    nome = (product.get("nome") or "").strip()
    aliases = []
    if nome:
        aliases.append(nome)
    designers = " ".join(designer_surnames(product))
    azienda = (product.get("azienda") or "").strip()
    azienda_attuale = (product.get("azienda_attuale") or "").strip()
    key = _norm_txt(" ".join([nome, designers, azienda, azienda_attuale]))

    # Eames: i nomi soli sono troppo generici, quindi aggiungiamo l'identita' vera del prodotto.
    if "eames" in key:
        eames_map = {
            "loungechair": ["Eames Lounge Chair", "Eames Lounge Chair and Ottoman"],
            "dsw": ["Eames DSW", "Eames Plastic Side Chair DSW"],
            "daw": ["Eames DAW", "Eames Plastic Armchair DAW"],
            "lcw": ["Eames LCW", "Eames Lounge Chair Wood LCW"],
            "lachaise": ["Eames La Chaise"],
            "elephant": ["Eames Elephant"],
            "wirechair": ["Eames Wire Chair"],
            "hangitall": ["Eames Hang-It-All", "Eames Hang It All"],
            "eamesstorageunit": ["Eames Storage Unit", "Eames ESU"],
            "sofacompact": ["Eames Sofa Compact"],
            "aluminumgroup": ["Eames Aluminum Group"],
            "timelifestool": ["Eames Time-Life Stool", "Eames Time Life Stool"],
        }
        for k, vals in eames_map.items():
            if k in key:
                aliases = vals + aliases
                break

    # Alcuni casi noti in cui il nome può confondersi con altro.
    special = {
        "miesandreabranzipoltronova": ["Mies Poltronova", "Mies Archizoom Poltronova", "Mies Andrea Branzi Poltronova"],
        "superleggeragioponticassina": ["Superleggera 699 Cassina", "699 Superleggera Gio Ponti"],
        "leggeragioponticassina": ["646 Leggera Gio Ponti Cassina", "Leggera Cassina Gio Ponti"],
        "timorenzomaridanese": ["Timor Enzo Mari Danese"],
        "tolomeomicheledelucchiartemide": ["Tolomeo Artemide Michele De Lucchi"],
        "louisghostphilippestarckkartell": ["Louis Ghost Kartell Philippe Starck"],
        "aramphilippestarckflos": ["Ara Flos Philippe Starck"],
    }
    for k, vals in special.items():
        if k in key:
            aliases = vals + aliases

    # Se il nome e' molto generico, aggiungi cognome designer al nome.
    generic_names = {"lounge chair", "elephant", "wire chair", "ara", "dr. glob", "la marie", "april", "sacco", "ghost", "toga"}
    if nome.lower() in generic_names and designers:
        aliases.append(f"{designers.split()[0]} {nome}")

    seen, out = set(), []
    for a in aliases:
        a = " ".join(str(a).split())
        if a and a.lower() not in seen:
            seen.add(a.lower())
            out.append(a)
    return out

def build_queries(product):
    """
    Query ordinate per affidabilita': prima site: ufficiale + alias preciso,
    poi query Google Images generali. L'obiettivo e' trovare immagini gia' pronte
    da catalogo, non immagini da scontornare.
    """
    nome = product.get("nome", "").strip()
    azienda = product.get("azienda", "").strip()
    azienda_attuale = (product.get("azienda_attuale") or "").strip()
    anno = str(product.get("anno", "")).strip()
    dp = principal_designer(product.get("designer", "")).strip()
    categoria = (product.get("categoria") or "").strip()
    aliases = product_aliases(product)
    domain = company_domain_for(product)

    queries = []

    # 0) Query "come la cercheresti su Google": spesso Google Images trova la
    # foto giusta in alto con una query molto semplice, es. "branzi mies".
    # Queste query servono a far entrare nel pool quei risultati, poi il ranking
    # privilegia fonte ufficiale + nome prodotto esatto.
    surnames = designer_surnames(product)
    if nome and surnames:
        queries.append(f"{surnames[0]} {nome}")
        queries.append(f'"{nome}" "{surnames[0]}"')
    if nome and azienda:
        queries.append(f"{nome} {azienda}")

    # 1) Prima fonte ufficiale. Se esiste una foto perfetta, spesso e' qui.
    if domain:
        for alias in aliases[:3]:
            if dp:
                queries.append(f'site:{domain} "{alias}" "{dp}"')
            queries.append(f'site:{domain} "{alias}"')

    # 2) Query precise con alias prodotto + designer/produttore.
    for alias in aliases[:4]:
        if dp and azienda:
            queries.append(f'"{alias}" "{dp}" "{azienda}"')
        if dp and azienda_attuale and azienda_attuale.lower() != azienda.lower():
            queries.append(f'"{alias}" "{dp}" "{azienda_attuale}"')
        if azienda:
            queries.append(f'"{alias}" "{azienda}"')
        if azienda_attuale and azienda_attuale.lower() != azienda.lower():
            queries.append(f'"{alias}" "{azienda_attuale}"')

    # 3) Se necessario, query descrittive da catalogo. Non usiamo mai parole tipo
    # cutout/remove background: attirano asset scontornati male.
    for alias in aliases[:2]:
        if categoria:
            queries.append(f'"{alias}" {categoria} product photo white background')
        queries.append(f'"{alias}" official product image')

    # 4) Vecchi fallback, ma solo dopo le query affidabili.
    if nome and dp and azienda:
        queries.append(f'"{nome}" "{dp}" "{azienda}"')
    if nome and azienda and anno:
        queries.append(f'"{nome}" "{azienda}" "{anno}"')
    if nome and azienda:
        queries.append(f'{nome} {azienda}')

    seen, out = set(), []
    for q in queries:
        q = " ".join(q.split())
        key = q.lower()
        if q and key not in seen:
            seen.add(key)
            out.append(q)
    return out[:10]

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



def official_domain_match(cand, product):
    """True se il candidato arriva dal dominio ufficiale del produttore/produttore attuale."""
    domain = company_domain_for(product)
    if not domain:
        return False
    dom = cand.get("source_domain") or domain_of(cand.get("page_url") or cand.get("source_page") or "") or domain_of(cand.get("image_url") or "")
    return bool(dom and (domain in dom or dom.endswith(domain)))


def is_multi_item_allowed(product):
    """Alcune categorie/progetti possono essere rappresentati da piu' elementi."""
    cat = (product.get("categoria") or "").lower()
    name = (product.get("nome") or "").lower()
    allowed_words = [
        "posate", "set", "serie", "sistema", "superficie", "progetto",
        "allestimento", "architettura", "modulare", "servizio", "famiglia",
    ]
    return any(w in cat or w in name for w in allowed_words)

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
            r = requests.get(SEARCHAPI_ENDPOINT, params=params, timeout=(5, REQUEST_TIMEOUT))
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


def product_identity_score(candidate, product):
    """Quanto il candidato sembra proprio quel prodotto, non solo un oggetto simile."""
    hay = " ".join(str(candidate.get(k, "")) for k in
                   ("title", "source_name", "page_url", "image_url")).lower()
    hay_norm = _norm_txt(hay)
    score = 0
    aliases = product_aliases(product)
    exact_alias = False
    for alias in aliases:
        an = _norm_txt(alias)
        if an and an in hay_norm:
            exact_alias = True
            score += 10
            break
    # nome base
    nome_norm = _norm_txt(product.get("nome", ""))
    if nome_norm and nome_norm in hay_norm:
        score += 4
    # designer: per prodotti storici e nomi generici e' essenziale
    for surname in designer_surnames(product):
        sn = _norm_txt(surname)
        if sn and sn in hay_norm:
            score += 5
            break
    # produttore / produttore attuale
    for azienda in _company_names(product):
        az = _norm_txt(azienda)
        if az and az in hay_norm:
            score += 5
            break
    return score, exact_alias


def is_probably_unrelated(candidate, product):
    """Blocca risultati chiaramente fuori tema, soprattutto per codici tipo T61/C, AT16, ecc."""
    hay = " ".join(str(candidate.get(k, "")) for k in
                   ("title", "source_name", "page_url", "image_url")).lower()
    cat = (product.get("categoria") or "").lower()
    nome = (product.get("nome") or "").lower()

    industrial_bad = [
        "pump", "pompa", "motor", "motore", "electric", "elettrico",
        "hinge", "cerniera", "hardware", "spare", "ricambio", "bearing",
        "valve", "valvola", "led bulb", "light bulb", "lampadina", "screw",
        "vite", "water", "pressure", "hydraulic", "compressor",
    ]
    # Se il prodotto non e' esso stesso tecnico/illuminazione, queste parole sono quasi sempre errore.
    allowed = any(k in cat for k in ["lamp", "lampada", "architettura", "automobile"])
    if not allowed and any(k in hay for k in industrial_bad):
        return True

    bad_visual_words = [
        "3d model", "obj", "fbx", "skp", "dwg", "cad", "texture", "render model",
        "replica", "inspired", "style", "poster", "print", "wallpaper", "stock photo",
    ]
    if any(k in hay for k in bad_visual_words):
        return True

    # Casi specifici: Leggera/Superleggera non sono intercambiabili.
    if "superleggera" in nome and "leggera" in hay and "superleggera" not in hay:
        return True
    if nome.strip() == "leggera" and "superleggera" in hay:
        return True

    return False


def rank_candidates(images_results, product):
    """
    Ordina i candidati privilegiando identita' esatta + fonte ufficiale + risoluzione.
    Non considera piu' la facilita' di scontorno: non scontorniamo nulla.
    """
    scored = []
    for cand in images_results:
        page = cand.get("page_url") or ""
        img = cand.get("image_url") or ""
        if not img:
            continue
        if is_probably_unrelated(cand, product):
            continue
        s_score, dom = source_score(cand, product)
        hits, nome_hit, az_hit, dp_hit = text_coherence(cand, product)
        ident_score, exact_alias = product_identity_score(cand, product)

        title_low = (cand.get("title") or "").lower()
        nome_low = (product.get("nome") or "").lower()
        hay_low = " ".join(str(cand.get(k, "")) for k in
                           ("title", "source_name", "page_url", "image_url")).lower()

        variant_penalty = 0
        hard_bad = (
            "miniatura", "miniature", "modellino", "scale model", "puzzle",
            "poster", "drawing", "sketch", "disegno", "dwg", "3d model",
            "replica", "inspired", "style", "auction lot", "lot ",
        )
        for kw in hard_bad:
            if kw in title_low and kw not in nome_low:
                variant_penalty -= 12
                break
        soft_variant = ("limited edition", "special edition", "custom", "prototype")
        if any(kw in hay_low for kw in soft_variant):
            variant_penalty -= 4

        # Tendenzialmente vogliamo un singolo prodotto, non set da asta o foto
        # ambiente. Lasciamo passare serie/sistemi/posate quando la categoria lo richiede.
        if not is_multi_item_allowed(product):
            multi_words = ("set of", "pair of", "lot of", "chairs", "sedie", "coppia", "lotto", "set ")
            if any(kw in hay_low for kw in multi_words):
                variant_penalty -= 10
            lifestyle_words = ("lifestyle", "interior", "room", "home", "sitting", "person", "people", "man ", "woman ")
            if any(kw in hay_low for kw in lifestyle_words):
                variant_penalty -= 8

        has_original = bool(cand.get("has_original"))
        w = cand.get("width") or 0
        h = cand.get("height") or 0
        long_side = max(w, h)
        short_side = min(w, h) if w and h else 0
        small = (long_side and long_side < MIN_SOURCE_LONG_SIDE) or (short_side and short_side < MIN_SOURCE_SHORT_SIDE)

        technical_bonus = 0
        if has_original:
            technical_bonus += 5
        if long_side >= 1600:
            technical_bonus += 6
        elif long_side >= 1200:
            technical_bonus += 4
        elif long_side >= 900:
            technical_bonus += 2
        elif long_side and long_side < 650:
            technical_bonus -= 8
        if w and h:
            ratio = max(w, h) / max(1, min(w, h))
            if ratio <= 2.2:
                technical_bonus += 1
            elif ratio >= 3.3:
                technical_bonus -= 3

        serp_pos = cand.get("serp_position") or 99
        serp_bonus = max(0, 14 - min(serp_pos, 14)) * 1.2

        # Regola dura: se non c'e' identita' del prodotto e non c'e' fonte ufficiale,
        # e' meglio non scaricare nulla che scaricare una pompa/cerniera/sedia sbagliata.
        if ident_score < 8 and s_score < 4 and hits < 2:
            continue

        official_boost = 0
        # Se il candidato arriva dal produttore ufficiale e il testo contiene
        # l'identita' del prodotto, deve superare quasi sempre marketplace e blog.
        if company_domain_for(product) and (company_domain_for(product) in dom or dom.endswith(company_domain_for(product))):
            official_boost += 24
            if exact_alias or ident_score >= 10:
                official_boost += 18

        total = (
            serp_bonus
            + s_score * 3.0
            + ident_score * 2.2
            + hits * 3
            + technical_bonus
            + official_boost
            + (-8 if small else 0)
            + variant_penalty
        )

        if exact_alias and s_score >= 4:
            conf = "alta"
        elif ident_score >= 14 and (s_score >= 4 or hits >= 2):
            conf = "alta"
        elif ident_score >= 9 or hits >= 2 or (s_score >= 4 and hits >= 1):
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
            "exact_alias": exact_alias,
            "identity_score": ident_score,
            "official_domain": bool(company_domain_for(product) and (company_domain_for(product) in dom or dom.endswith(company_domain_for(product)))),
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
    # Non upscaliamo oltre la sorgente: se la fonte e' 1000px, non la gonfiamo a 1600px.
    # Questo evita bordi seghettati/artefatti amplificati. Il canvas resta 1600x1600.
    scale = min(FINAL_SIZE / w, FINAL_SIZE / h, 1.0)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    resized = rgb.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGB", (FINAL_SIZE, FINAL_SIZE), (255, 255, 255))
    canvas.paste(resized, ((FINAL_SIZE - nw) // 2, (FINAL_SIZE - nh) // 2))
    return canvas

def save_jpeg_capped(image, path):
    """
    Salva JPEG ad alta qualita'. Non cerchiamo piu' di comprimere fino a un target basso:
    usiamo la qualita' piu' alta possibile entro MAX_KB. Questo elimina l'effetto
    'immagine da 30 KB' quando la sorgente era buona.
    """
    im = image.convert("RGB")
    max_bytes = MAX_KB * 1024

    # Prima prova: massima qualita', niente optimize/progressive per evitare microartefatti
    # e per non rincorrere file inutilmente piccoli.
    for q in range(JPEG_Q_START, JPEG_Q_MIN - 1, -2):
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=q, subsampling=0, optimize=False, progressive=False)
        size = buf.tell()
        if size <= max_bytes:
            with open(path, "wb") as fh:
                fh.write(buf.getvalue())
            return round(size / 1024, 1), q, im.size

    # Se e' ancora troppo pesante, riduci il canvas gradualmente, non la qualita' all'infinito.
    while im.width > 1100:
        new_side = int(im.width * 0.9)
        im = im.resize((new_side, new_side), Image.LANCZOS)
        for q in range(JPEG_Q_START, JPEG_Q_MIN - 1, -2):
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=q, subsampling=0, optimize=False, progressive=False)
            size = buf.tell()
            if size <= max_bytes:
                with open(path, "wb") as fh:
                    fh.write(buf.getvalue())
                return round(size / 1024, 1), q, im.size

    # Fallback: salva comunque.
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=JPEG_Q_MIN, subsampling=0, optimize=False, progressive=False)
    with open(path, "wb") as fh:
        fh.write(buf.getvalue())
    return round(buf.tell() / 1024, 1), JPEG_Q_MIN, im.size


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


def _open_image_from_bytes(content):
    im = Image.open(io.BytesIO(content))
    # Gestisci PNG/WebP con alpha senza scontornare: compositing diretto su bianco.
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        white.alpha_composite(rgba)
        return white.convert("RGB")
    return im.convert("RGB")


def source_quality_ok(content, cand):
    """Controllo leggero: evita sorgenti chiaramente troppo piccole/povere."""
    try:
        im = Image.open(io.BytesIO(content))
        w, h = im.size
    except Exception:
        return False, "immagine non leggibile"
    long_side = max(w, h)
    short_side = min(w, h)
    bytes_len = len(content)
    if long_side < 1200 or short_side < 650:
        return False, f"sorgente troppo piccola ({w}x{h})"
    if bytes_len < 55 * 1024:
        return False, f"file sorgente troppo leggero ({round(bytes_len/1024,1)}KB)"
    # se SearchApi dichiara una sorgente piccola, penalizza anche se Pillow apre.
    cw, ch = cand.get("w") or 0, cand.get("h") or 0
    if cw and ch and (max(cw, ch) < 1200 or min(cw, ch) < 650):
        return False, f"SearchApi indica bassa risoluzione ({cw}x{ch})"
    return True, f"sorgente {w}x{h}, {round(bytes_len/1024,1)}KB"


def standardize(content, want_white_removal=False):
    """
    Standardizzazione conservativa: NO rembg, NO flood-fill, NO crop.
    L'immagine sorgente viene solo:
      1. aperta alla massima qualita' disponibile;
      2. convertita su sfondo bianco se ha alpha;
      3. ridimensionata intera dentro un canvas bianco quadrato.
    """
    info = {
        "background_standardized": True,
        "padding_standardized": True,
        "needs_review": False,
        "reason": "",
        "method": "preserva_originale_no_crop_no_rembg",
        "cutout_quality": 100,
    }
    im = _open_image_from_bytes(content)
    canvas = whole_image_on_square_canvas(im)
    info["reason"] = f"immagine preservata intera: sorgente {im.width}x{im.height}; niente scontorno/crop"
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
        "candidate_review_dir": os.path.join(pipeline, CANDIDATE_REVIEW_SUB),
        "scarti_dir": os.path.join(pipeline, SCARTI_SUB),
        "rejected_json": os.path.join(pipeline, "scartati.json"),
        "review_urls_json": os.path.join(pipeline, "review_urls.json"),
        "manifest": os.path.join(pipeline, "manifest_images.csv"),
        "review": os.path.join(pipeline, "review_needed.csv"),
        "products_out": os.path.join(pipeline, "prodotti_with_images.json"),
        "log_errors": os.path.join(pipeline, "log_errors.txt"),
    }
    for d in (images_dir, pipeline, paths["originals_dir"],
              paths["review_dir"], paths["candidate_review_dir"], paths["scarti_dir"]):
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
# Review multi-candidato
# --------------------------------------------------------------------------- #

CANDIDATE_INDEX_COLUMNS = [
    "n", "file", "score", "confidence", "query", "serp_position",
    "source_domain", "source_page", "image_url", "title", "source_size",
    "output_size", "kb", "quality_note", "orig_file"
]


def candidate_order_key(c):
    """
    Ordine umano: prima le query semplici nell'ordine in cui le abbiamo generate,
    poi la posizione Google Images. Il punteggio resta informativo, non decide da solo.
    """
    return (
        c.get("query_index", 999),
        c.get("serp_position") or 999,
        -float(c.get("score") or 0),
    )


def _short_domain(dom):
    return slugify((dom or "src").split(":")[0])[:28] or "src"


def make_contact_sheet(saved_items, sheet_path):
    """Crea un foglio contatto semplice con i candidati salvati."""
    if not saved_items:
        return
    thumbs = []
    for item in saved_items:
        try:
            im = Image.open(item["path"]).convert("RGB")
            im.thumbnail((300, 300), Image.LANCZOS)
            tile = Image.new("RGB", (340, 380), (255, 255, 255))
            tile.paste(im, ((340 - im.width) // 2, 20))
            # Etichetta minimale: numero, dominio, score.
            from PIL import ImageDraw
            draw = ImageDraw.Draw(tile)
            label = f"#{item['n']}  {item.get('domain','')}  score {item.get('score','')}"
            draw.text((12, 330), label[:48], fill=(0, 0, 0))
            thumbs.append(tile)
        except Exception:
            continue
    if not thumbs:
        return
    cols = 4
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * 340, rows * 380), (245, 245, 245))
    for i, t in enumerate(thumbs):
        x = (i % cols) * 340
        y = (i // cols) * 380
        sheet.paste(t, (x, y))
    sheet.save(sheet_path, "JPEG", quality=92, subsampling=0)


def save_candidate_review_set(product, candidates, paths, base_no_ext, filename_finale):
    """
    Modalita' corretta per questo progetto: non elegge un vincitore automatico.
    Salva N candidati, interi e senza scontorno, in una cartella review dedicata.
    """
    folder = os.path.join(paths["candidate_review_dir"], base_no_ext)
    os.makedirs(folder, exist_ok=True)

    # Ripulisci solo i vecchi candidati dello stesso prodotto, non tutta la review.
    for f in os.listdir(folder):
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".csv")):
            try:
                os.remove(os.path.join(folder, f))
            except Exception:
                pass

    ordered = sorted(candidates, key=candidate_order_key)
    saved_rows = []
    saved_items = []
    saved = 0
    tried = 0
    max_try = max(CANDIDATES_PER_PRODUCT * 4, CANDIDATES_PER_PRODUCT + 8)

    deferred = []

    for cand in ordered:
        if saved >= CANDIDATES_PER_PRODUCT or tried >= max_try:
            break
        tried += 1
        try:
            content, ext = download_image(cand["image_url"])
            ok_src, src_reason = source_quality_ok(content, cand)
            if not ok_src:
                deferred.append((cand, content, ext, src_reason))
                continue
            final_im, info = standardize(content, want_white_removal=False)
        except Exception as exc:  # noqa: BLE001
            log_error(paths, f"{product.get('nome','?')} candidato review: {exc}")
            continue

        saved += 1
        dom = cand.get("source_domain") or domain_of(cand.get("source_page") or cand.get("image_url") or "")
        out_name = review_candidate_filename(base_no_ext, saved)
        out_path = os.path.join(folder, out_name)
        kb, q, size = save_jpeg_capped(final_im, out_path)

        # Salva anche l'originale accanto, solo se utile per verificare la qualita' sorgente.
        orig_name = f"{saved:02d}__ORIG__{base_no_ext}{ext}"
        try:
            with open(os.path.join(folder, orig_name), "wb") as fh:
                fh.write(content)
        except Exception:
            orig_name = ""

        row = {
            "n": saved,
            "file": out_name,
            "score": cand.get("score", ""),
            "confidence": cand.get("confidence", ""),
            "query": cand.get("query", ""),
            "serp_position": cand.get("serp_position", ""),
            "source_domain": dom,
            "source_page": cand.get("source_page", ""),
            "image_url": cand.get("image_url", ""),
            "title": cand.get("title", ""),
            "source_size": f"{cand.get('w') or ''}x{cand.get('h') or ''}",
            "output_size": f"{size[0]}x{size[1]}",
            "kb": kb,
            "quality_note": src_reason,
            "orig_file": orig_name,
        }
        saved_rows.append(row)
        saved_items.append({"path": out_path, "n": saved, "domain": dom, "score": cand.get("score", "")})

    # Se non abbiamo salvato nulla di qualita' sufficiente, salva pochi fallback
    # invece di lasciare il prodotto vuoto. Questi saranno segnalati in quality_note.
    if saved == 0 and deferred:
        for cand, content, ext, src_reason in deferred[:CANDIDATES_PER_PRODUCT]:
            try:
                final_im, info = standardize(content, want_white_removal=False)
            except Exception as exc:  # noqa: BLE001
                log_error(paths, f"{product.get('nome','?')} candidato fallback review: {exc}")
                continue
            saved += 1
            dom = cand.get("source_domain") or domain_of(cand.get("source_page") or cand.get("image_url") or "")
            out_name = review_candidate_filename(base_no_ext, saved)
            out_path = os.path.join(folder, out_name)
            kb, q, size = save_jpeg_capped(final_im, out_path)
            orig_name = f"{saved:02d}__ORIG__{base_no_ext}{ext}"
            try:
                with open(os.path.join(folder, orig_name), "wb") as fh:
                    fh.write(content)
            except Exception:
                orig_name = ""
            row = {
                "n": saved,
                "file": out_name,
                "score": cand.get("score", ""),
                "confidence": cand.get("confidence", ""),
                "query": cand.get("query", ""),
                "serp_position": cand.get("serp_position", ""),
                "source_domain": dom,
                "source_page": cand.get("source_page", ""),
                "image_url": cand.get("image_url", ""),
                "title": cand.get("title", ""),
                "source_size": f"{cand.get('w') or ''}x{cand.get('h') or ''}",
                "output_size": f"{size[0]}x{size[1]}",
                "kb": kb,
                "quality_note": "FALLBACK BASSA QUALITA: " + src_reason,
                "orig_file": orig_name,
            }
            saved_rows.append(row)
            saved_items.append({"path": out_path, "n": saved, "domain": dom, "score": cand.get("score", "")})
            if saved >= CANDIDATES_PER_PRODUCT:
                break

    if saved_rows:
        write_csv(os.path.join(folder, "_index.csv"), saved_rows, CANDIDATE_INDEX_COLUMNS)
        make_contact_sheet(saved_items, os.path.join(folder, "_contact_sheet.jpg"))

    return saved_rows



# --------------------------------------------------------------------------- #
# Review flat: candidati direttamente in _pipeline/review_images
# --------------------------------------------------------------------------- #

def catalog_background_ok(content):
    """True se l'immagine sembra gia' una foto prodotto su fondo chiaro/bianco."""
    try:
        im = Image.open(io.BytesIO(content))
        # Trasparenza: va bene, la mettiamo su bianco senza scontornare.
        if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
            return True, "sorgente con trasparenza"
        rgb = im.convert("RGB")
        w, h = rgb.size
        if w < 2 or h < 2:
            return False, "immagine troppo piccola"
        # Controlla i bordi: devono essere molto chiari e abbastanza neutri.
        px = rgb.load()
        step = max(1, min(w, h) // 180)
        vals = []
        for x in range(0, w, step):
            vals.append(px[x, 0]); vals.append(px[x, h - 1])
        for y in range(0, h, step):
            vals.append(px[0, y]); vals.append(px[w - 1, y])
        if not vals:
            return False, "nessun bordo leggibile"
        good = 0
        for r, g, b in vals:
            mx, mn = max(r, g, b), min(r, g, b)
            # bianco / grigio molto chiaro / off-white: ok. Colori o ambienti: no.
            if mn >= 232 and (mx - mn) <= 22:
                good += 1
        frac = good / len(vals)
        if frac >= 0.82:
            return True, f"sfondo chiaro pulito ai bordi ({frac:.0%})"
        return False, f"sfondo non pulito/ambientato ai bordi ({frac:.0%})"
    except Exception as exc:  # noqa: BLE001
        return False, f"sfondo non verificabile ({exc})"


def semantic_review_ok(cand):
    """Filtro testuale leggero: non salva candidati palesemente fuori prodotto."""
    score = float(cand.get("score") or 0)
    ident = int(cand.get("identity_score") or 0)
    conf = cand.get("confidence") or ""
    # Candidato forte: primo risultato o fonte ufficiale, ma serve almeno identita' minima.
    if cand.get("official_domain") and (cand.get("exact_alias") or ident >= 10):
        return True
    if conf == "alta" and score >= 32:
        return True
    if conf == "media" and score >= 38 and ident >= 9:
        return True
    # Permetti i primissimi risultati Google se non sono semanticamente deboli.
    if (cand.get("serp_position") or 99) <= 3 and ident >= 9 and score >= 25:
        return True
    return False


def candidate_is_very_strong(cand):
    """Se il primo candidato e' gia' chiaramente quello giusto, non scarichiamo alternative inutili."""
    return bool(
        (cand.get("serp_position") or 99) <= 2
        and (cand.get("official_domain") or cand.get("confidence") == "alta")
        and (cand.get("exact_alias") or int(cand.get("identity_score") or 0) >= 12)
        and float(cand.get("score") or 0) >= 38
    )


def save_flat_review_set(product, candidates, paths, base_no_ext, filename_finale):
    """
    Salva candidati direttamente in _pipeline/review_images.

    Regola importante:
      - prima prova a salvare candidati puliti/qualitativi;
      - se i filtri sono troppo severi e non salva nulla, salva comunque
        fallback visibili in review_images, segnalandoli come FALLBACK nel CSV.
    Questo evita la situazione assurda: "19 errori" e zero immagini da guardare.
    """
    review_dir = paths["review_dir"]
    os.makedirs(review_dir, exist_ok=True)

    # Ripulisci candidati vecchi dello stesso prodotto.
    for f in os.listdir(review_dir):
        if is_review_file_for_base(f, base_no_ext):
            try:
                os.remove(os.path.join(review_dir, f))
            except Exception:
                pass

    ordered = sorted(candidates, key=candidate_order_key)
    rows = []
    saved = 0
    tried = 0
    max_try = max(CANDIDATES_PER_PRODUCT * 8, 16)

    # Scarti globali: se un URL/pagina e' stato bocciato, non torna.
    try:
        rejected_tokens = all_rejected_tokens(load_rejections(paths))
    except Exception:
        rejected_tokens = set()

    # Hash scarti globali: confronto visivo con tutta la cartella scarti.
    scarti_hashes = []
    scarti_dir = paths.get("scarti_dir")
    if scarti_dir and os.path.isdir(scarti_dir):
        for sf in os.listdir(scarti_dir):
            try:
                ext = os.path.splitext(sf)[1].lower()
                if ext in IMG_EXTS:
                    scarti_hashes.append(image_ahash_from_path(os.path.join(scarti_dir, sf)))
            except Exception:
                pass

    deferred = []  # candidati scaricabili ma scartati da filtri qualita/sfondo

    def _save_candidate(cand, content, note_prefix, src_reason="", bg_reason=""):
        nonlocal saved
        try:
            final_im, info = standardize(content, want_white_removal=False)
        except Exception as exc:  # noqa: BLE001
            log_error(paths, f"{product.get('nome','?')} standardize review: {exc}")
            return False

        saved += 1
        out_name = review_candidate_filename(base_no_ext, saved)
        out_path = os.path.join(review_dir, out_name)
        kb, q, size = save_jpeg_capped(final_im, out_path)

        out_stem = os.path.splitext(out_name)[0]
        try:
            cand_hash = image_ahash_from_image(final_im)
        except Exception:
            cand_hash = ""

        record_review_url(paths, out_stem, cand.get("image_url", ""),
                          product_base=base_no_ext,
                          source_page=cand.get("source_page", ""),
                          image_hash=cand_hash)

        dom = cand.get("source_domain") or domain_of(cand.get("source_page") or cand.get("image_url") or "")
        row = {
            "n": saved,
            "file": out_name,
            "score": cand.get("score", ""),
            "confidence": cand.get("confidence", ""),
            "query": cand.get("query", ""),
            "serp_position": cand.get("serp_position", ""),
            "source_domain": dom,
            "source_page": cand.get("source_page", ""),
            "image_url": cand.get("image_url", ""),
            "title": cand.get("title", ""),
            "source_size": f"{cand.get('w') or ''}x{cand.get('h') or ''}",
            "output_size": f"{size[0]}x{size[1]}",
            "kb": kb,
            "quality_note": f"{note_prefix}; {src_reason}; {bg_reason}; q={q}; {info.get('reason','')}",
            "orig_file": "",
        }
        rows.append(row)
        return True

    # 1) Primo passaggio: candidati puliti.
    for cand in ordered:
        if saved >= CANDIDATES_PER_PRODUCT or tried >= max_try:
            break
        tried += 1

        if candidate_is_rejected(cand, rejected_tokens):
            if DEBUG_CANDIDATES:
                print("    skip scarti: URL/pagina gia' bocciati")
            continue

        if not semantic_review_ok(cand):
            if DEBUG_CANDIDATES:
                print(f"    skip semantico: score={cand.get('score')} id={cand.get('identity_score')} pos={cand.get('serp_position')} {cand.get('source_domain')}")
            continue

        try:
            content, ext = download_image(cand["image_url"])
        except Exception as exc:  # noqa: BLE001
            log_error(paths, f"{product.get('nome','?')} candidato flat: {exc}")
            continue

        if content_matches_scarti(content, scarti_hashes):
            if DEBUG_CANDIDATES:
                print("    skip scarti: immagine gia' bocciata visivamente")
            continue

        ok_src, src_reason = source_quality_ok(content, cand)
        ok_bg, bg_reason = catalog_background_ok(content)

        if ok_src and ok_bg:
            _save_candidate(cand, content, "OK", src_reason, bg_reason)
            # Se il primo candidato e' fortissimo, basta una sola immagine.
            if saved == 1 and candidate_is_very_strong(cand):
                break
        else:
            # Non buttarlo via: se non troviamo nulla di pulito, almeno lo vedrai.
            deferred.append((cand, content, src_reason, bg_reason))

    # 2) Fallback visibile: se i filtri hanno escluso tutto, salva comunque i migliori scaricabili.
    if saved == 0 and deferred:
        if DEBUG_CANDIDATES:
            print(f"    fallback visibile: salvo {min(CANDIDATES_PER_PRODUCT, len(deferred))} candidati anche se non perfetti")
        for cand, content, src_reason, bg_reason in deferred[:CANDIDATES_PER_PRODUCT]:
            if saved >= CANDIDATES_PER_PRODUCT:
                break
            _save_candidate(cand, content, "FALLBACK_DA_CONTROLLARE", src_reason, bg_reason)

    # 3) Ultimo fallback: se deferred era vuoto per colpa dei filtri semantici, prova i primissimi non-scarti.
    if saved == 0:
        for cand in ordered[:max_try]:
            if saved >= CANDIDATES_PER_PRODUCT:
                break
            if candidate_is_rejected(cand, rejected_tokens):
                continue
            try:
                content, ext = download_image(cand["image_url"])
            except Exception as exc:  # noqa: BLE001
                log_error(paths, f"{product.get('nome','?')} fallback estremo download: {exc}")
                continue
            if content_matches_scarti(content, scarti_hashes):
                continue
            ok_src, src_reason = source_quality_ok(content, cand)
            ok_bg, bg_reason = catalog_background_ok(content)
            _save_candidate(cand, content, "FALLBACK_ESTREMO_SEMANTICA_NON_SICURA", src_reason, bg_reason)

    # Aggiorna indice globale.
    if rows:
        index_path = os.path.join(paths["pipeline"], "review_candidates_flat.csv")
        old_rows = []
        if os.path.exists(index_path):
            try:
                with open(index_path, "r", encoding="utf-8", newline="") as fh:
                    old_rows = [r for r in csv.DictReader(fh) if not is_review_file_for_base(r.get("file", ""), base_no_ext)]
            except Exception:
                old_rows = []
        write_csv(index_path, old_rows + rows, CANDIDATE_INDEX_COLUMNS)

    return rows

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
    if any(is_review_file_for_base(f, base_no_ext) for f in os.listdir(paths["review_dir"])) or base_key in review_names:
        row["status"] = "already_exists"
        row["motivo"] = "gia' in review_images/review_candidates (in attesa di giudizio): saltato"
        return row, None
    if not RETRY_SCARTI and scarti_contains_base(paths, base_no_ext):
        row["status"] = "already_exists"
        row["motivo"] = "gia' in _pipeline/scarti: saltato per non riproporre immagini gia' bocciate"
        return row, None

    # Controllo scarti GLOBALE: evita di riproporre la stessa immagine anche
    # se nel frattempo hai cambiato nome file, designer/foto nel JSON o prodotto simile.
    bad_urls = all_rejected_tokens(rejected)

    queries = build_queries(product)
    candidates = []
    used_query = ""
    seen_urls = set()
    # Cerchiamo su piu' query precise, non solo sulla prima: spesso la foto perfetta
    # e' al primo risultato di una query ufficiale leggermente diversa.
    for q_index, q in enumerate(queries):
        try:
            results = searchapi_google_images(q, api_key)
        except Exception as exc:  # noqa: BLE001
            log_error(paths, f"{product.get('nome','?')}: {exc}")
            continue
        ranked = rank_candidates(results, product)
        ranked = [c for c in ranked if not candidate_is_rejected(c, bad_urls)]
        # In modalita' review batch rispettiamo l'ordine Google/SearchApi.
        # Lo score serve solo a filtrare i risultati palesemente sbagliati, non a ribaltare la SERP.
        if CANDIDATES_PER_PRODUCT > 1:
            ranked = sorted(ranked, key=lambda c: c.get("serp_position") or 999)
        for c in ranked[:18]:
            if c["image_url"] not in seen_urls:
                c = dict(c)
                c["query"] = q
                c["query_index"] = q_index
                c["pool_order"] = len(candidates) + 1
                candidates.append(c)
                seen_urls.add(c["image_url"])
        if not used_query and ranked:
            used_query = q
        # Se abbiamo gia' un primo candidato molto forte in batch review, non serve bruciare query extra.
        if CANDIDATES_PER_PRODUCT > 1 and candidates and candidate_is_very_strong(candidates[0]):
            break
        # Se abbiamo gia' vari candidati forti da fonte ufficiale, basta.
        strong = [c for c in candidates if c.get("confidence") == "alta" and c.get("score", 0) >= 40]
        if len(strong) >= max(2, CANDIDATES_PER_PRODUCT):
            break
        time.sleep(SLEEP_BETWEEN)

    # In modalita' review multi-candidato NON vogliamo che uno score interno scelga il vincitore.
    # Ordiniamo come un umano: query in ordine + posizione Google. Il punteggio serve solo come informazione.
    if CANDIDATES_PER_PRODUCT > 1:
        candidates.sort(key=candidate_order_key)
    else:
        candidates.sort(key=lambda c: (c["score"], -min(c.get("serp_position") or 99, 99)), reverse=True)

        # Regola importantissima: se nel pool c'e' un candidato dal dominio ufficiale
        # con identita' prodotto buona, lo proviamo prima.
        official_good = [
            c for c in candidates
            if c.get("official_domain") and (c.get("exact_alias") or c.get("identity_score", 0) >= 10)
        ]
        if official_good:
            official_good.sort(key=lambda c: (min(c.get("serp_position") or 99, 99), -c.get("score", 0)))
            rest = [c for c in candidates if c not in official_good]
            candidates = official_good + rest

    row["query_usata"] = used_query or (queries[0] if queries else "")

    if not candidates:
        row["status"] = "not_found"
        row["confidence"] = "da_verificare"
        row["motivo"] = ("nessun candidato nuovo dalla ricerca"
                         if bad_urls else "nessun candidato dalla ricerca")
        return row, "review"

    if CANDIDATES_PER_PRODUCT > 1:
        saved_rows = save_flat_review_set(product, candidates, paths, base_no_ext, filename_finale)
        if not saved_rows:
            row["status"] = "download_failed"
            row["motivo"] = "nessun candidato scaricabile dopo filtri scarti/download; controlla _pipeline/log_errors.txt"
            return row, "review"
        first = saved_rows[0]
        row["image_downloaded"] = True
        row["final_standardized"] = True
        row["image_url"] = first.get("image_url", "")
        row["source_page"] = first.get("source_page", "")
        row["source_domain"] = first.get("source_domain", "")
        row["confidence"] = "review_flat"
        row["background_standardized"] = True
        row["padding_standardized"] = True
        row["status"] = "review_needed"
        row["motivo"] = (f"salvati {len(saved_rows)} candidati filtrati direttamente in _pipeline/review_images "
                         f"come {base_no_ext}.jpg, {base_no_ext}2.jpg, ecc.; scegli quello giusto e spostalo/rinominalo {filename_finale}")
        return row, "review"

    best = candidates[0]
    row["image_url"] = best["image_url"]
    row["source_page"] = best["source_page"]
    row["source_domain"] = best["source_domain"]
    row["confidence"] = best["confidence"]

    # Prova piu' candidati e scegli il primo con buona identita' e sorgente decente.
    # Non facciamo piu' scontorno: se la sorgente e' brutta o gia' scontornata male, la scartiamo.
    MAX_TRY = 18
    fallback_result = None   # (choice_score, final_im, info, content, ext, cand)

    if DEBUG_CANDIDATES:
        print(f"  Query usate: {', '.join(queries[:4])}{' ...' if len(queries) > 4 else ''}")
        for j, c in enumerate(candidates[:12], 1):
            print(f"  cand {j:02d} score={c.get('score')} conf={c.get('confidence')} "
                  f"id={c.get('identity_score')} exact={c.get('exact_alias')} official={c.get('official_domain')} "
                  f"{c.get('w')}x{c.get('h')} pos={c.get('serp_position')} | "
                  f"{c.get('source_domain')} | {str(c.get('title',''))[:80]} | q={c.get('query','')[:45]}")
            print(f"       img={c.get('image_url','')[:150]}")
            print(f"       page={c.get('source_page','')[:150]}")

    for cand in candidates[:MAX_TRY]:
        # scarta candidati semanticamente deboli se esistono alternative migliori
        if cand.get("confidence") in ("bassa", "da_verificare") and cand.get("score", 0) < 30:
            if DEBUG_CANDIDATES:
                print(f"    skip debole: {cand.get('title','')[:70]}")
            continue
        try:
            content, ext = download_image(cand["image_url"])
        except Exception as exc:  # noqa: BLE001
            log_error(paths, f"{product.get('nome','?')} download: {exc}")
            continue

        scarti_hashes = load_scarti_hashes_for_base(paths, base_no_ext)
        if content_matches_scarti(content, scarti_hashes):
            if DEBUG_CANDIDATES:
                print("    skip scarti: immagine gia' bocciata visivamente")
            continue

        ok_src, src_reason = source_quality_ok(content, cand)
        if not ok_src:
            # tienilo solo come fallback estremo se il ranking e' altissimo.
            if cand.get("confidence") != "alta" or cand.get("score", 0) < 55:
                if DEBUG_CANDIDATES:
                    print(f"    skip qualita sorgente: {src_reason}")
                continue

        try:
            final_im, info = standardize(content, want_white_removal=False)
        except Exception as exc:  # noqa: BLE001
            log_error(paths, f"{product.get('nome','?')} standardize: {exc}")
            continue

        method = info.get("method", "")
        quality_penalty = 0 if ok_src else -18
        choice_score = cand.get("score", 0) + quality_penalty
        info["reason"] = f"{info.get('reason','')} | {src_reason} | query: {cand.get('query','')}"

        if DEBUG_CANDIDATES:
            print(f"    prova OK score_finale={choice_score:.1f} method={method} | {src_reason}")

        if fallback_result is None or choice_score > fallback_result[0]:
            fallback_result = (choice_score, final_im, info, content, ext, cand)

        # Sufficientemente buona: fermati. Preferiamo la prima buona, non una ricerca infinita.
        if ok_src and cand.get("confidence") in ("alta", "media") and cand.get("score", 0) >= 36:
            break

    if fallback_result is None:
        row["status"] = "download_failed"
        row["motivo"] = "nessun candidato con identita/qualita sorgente sufficienti"
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
    try:
        cand_hash = image_ahash_from_image(final_im)
    except Exception:
        cand_hash = ""
    record_review_url(paths, base_no_ext, cand["image_url"], product_base=base_no_ext,
                      source_page=cand.get("source_page", ""), image_hash=cand_hash)

    method = info.get("method", "")
    qtxt = f"metodo {method}, qualita' {quality}/100"
    if info["needs_review"]:
        row["motivo"] = f"{info['reason'] or 'da controllare'} | conf: {cand['confidence']} | {qtxt}"
    else:
        row["motivo"] = f"pronta ({qtxt}, conf: {cand['confidence']}, rank Google {cand.get('serp_position','?')}) - da approvare"
    return row, "review"


def _find_product_for_only(products, only_value):
    """Ritorna il prodotto unico filtrato da --only, o None se ambiguo/non trovato."""
    if not only_value:
        return None, "usa --only con il nome del prodotto da promuovere"
    needle = only_value.lower().strip()
    matches = []
    for p in products:
        hay = " ".join([
            str(p.get("nome", "")),
            all_designers_str(p.get("designer", "")),
            str(p.get("azienda", "")),
            str(p.get("azienda_attuale", "")),
            str(p.get("foto", "")),
        ]).lower()
        if needle in hay:
            matches.append(p)
    if not matches:
        return None, f"nessun prodotto trovato per --only {only_value!r}"
    if len(matches) > 1:
        names = ", ".join(f"{m.get('nome','?')} ({resolve_filename(m)})" for m in matches[:8])
        return None, f"--only {only_value!r} trova piu prodotti: {names}. Usa una stringa piu precisa."
    return matches[0], ""


def _image_resolution(path):
    try:
        with Image.open(path) as im:
            return im.size
    except Exception:
        return (0, 0)


def promote_candidate(product, paths, candidate_n):
    """
    Promuove un candidato scelto da _pipeline/review_candidates/<base>/
    al nome finale corretto in public/immagini/<foto>. Usa l'ORIG se esiste,
    per evitare la copia gia' ricompressa/standardizzata.
    """
    filename_finale = resolve_filename(product)
    base_no_ext = os.path.splitext(filename_finale)[0]
    folder = os.path.join(paths["candidate_review_dir"], base_no_ext)
    index_path = os.path.join(folder, "_index.csv")
    if not os.path.isdir(folder):
        raise RuntimeError(f"cartella candidati non trovata: {folder}")
    if not os.path.exists(index_path):
        raise RuntimeError(f"_index.csv non trovato in: {folder}")

    rows = []
    with open(index_path, "r", encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            rows.append(r)
    wanted = None
    for r in rows:
        try:
            if int(r.get("n", "0")) == int(candidate_n):
                wanted = r
                break
        except Exception:
            pass
    if wanted is None:
        raise RuntimeError(f"candidato #{candidate_n} non trovato in {index_path}")

    # Preferisci l'originale non ricompresso, se presente.
    orig_file = (wanted.get("orig_file") or "").strip()
    candidate_file = (wanted.get("file") or "").strip()
    source_path = ""
    if orig_file and os.path.exists(os.path.join(folder, orig_file)):
        source_path = os.path.join(folder, orig_file)
    else:
        # fallback: cerca per pattern 02__ORIG__base.*
        prefix = f"{int(candidate_n):02d}__ORIG__{base_no_ext}"
        for f in os.listdir(folder):
            if f.startswith(prefix):
                source_path = os.path.join(folder, f)
                break
    if not source_path:
        source_path = os.path.join(folder, candidate_file)
    if not os.path.exists(source_path):
        raise RuntimeError(f"file sorgente candidato non trovato: {source_path}")

    with open(source_path, "rb") as fh:
        content = fh.read()
    final_im, info = standardize(content, want_white_removal=False)
    out_path = os.path.join(paths["images_dir"], filename_finale)
    kb, q, size = save_jpeg_capped(final_im, out_path)
    sw, sh = _image_resolution(source_path)
    print("PROMOSSO")
    print(f"  prodotto:     {product.get('nome','?')}")
    print(f"  candidato:    #{candidate_n}")
    print(f"  sorgente:     {source_path} ({sw}x{sh})")
    print(f"  destinazione: {out_path}")
    print(f"  output:       {size[0]}x{size[1]}, {kb} KB, q={q}")
    print(f"  nota:         {info.get('reason','')}")
    return out_path

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
    parser.add_argument("--debug-candidates", action="store_true",
                        help="stampa i primi candidati SearchApi e il motivo degli skip")
    parser.add_argument("--candidates-per-product", type=int, default=2,
                        help="quante alternative salvare per prodotto in _pipeline/review_images (default: 2). Usa 1 per una sola immagine per prodotto.")
    parser.add_argument("--promote-candidate", type=int, default=0,
                        help="vecchia funzione opzionale; per il nuovo flusso puoi ignorarla e rinominare manualmente i file in review_images.")
    parser.add_argument("--retry-scarti", action="store_true",
                        help="forza un nuovo tentativo anche per prodotti che hanno gia' file in _pipeline/scarti")
    parser.add_argument("--inspect-json", default="",
                        help="mostra i record JSON che contengono questa stringa, senza usare crediti API")
    args = parser.parse_args()

    global DEBUG_CANDIDATES, CANDIDATES_PER_PRODUCT, RETRY_SCARTI
    DEBUG_CANDIDATES = bool(args.debug_candidates)
    CANDIDATES_PER_PRODUCT = max(1, int(args.candidates_per_product or 1))
    RETRY_SCARTI = bool(args.retry_scarti)
    print(f"VERSIONE SCRIPT: {SCRIPT_VERSION}")

    input_path = args.input
    if not os.path.exists(input_path):
        script_root = os.path.dirname(os.path.abspath(__file__))
        alt = os.path.join(script_root, args.input)
        if os.path.exists(alt):
            input_path = alt
        else:
            print(f"ERRORE: file non trovato: {args.input}", file=sys.stderr)
            sys.exit(1)

    with open(input_path, "r", encoding="utf-8") as fh:
        products_all = json.load(fh)
    if not isinstance(products_all, list):
        print("ERRORE: il JSON deve essere una lista di prodotti.", file=sys.stderr)
        sys.exit(1)

    print(f"JSON letto: {os.path.abspath(input_path)}")

    if args.inspect_json:
        inspect_json_products(products_all, args.inspect_json)
        return

    paths = build_paths(args.root)

    if args.promote_candidate:
        product, err = _find_product_for_only(products_all, args.only)
        if err:
            print(f"ERRORE: {err}", file=sys.stderr)
            sys.exit(1)
        try:
            promote_candidate(product, paths, args.promote_candidate)
        except Exception as exc:  # noqa: BLE001
            print(f"ERRORE promozione candidato: {exc}", file=sys.stderr)
            sys.exit(1)
        return

    api_key = (os.environ.get("SEARCHAPI_KEY", "")
               or os.environ.get("SERPAPI_KEY", "")).strip()
    if not api_key:
        print("ERRORE: imposta la variabile d'ambiente SEARCHAPI_KEY.", file=sys.stderr)
        sys.exit(1)

    products = products_all
    if args.only:
        needle = args.only.lower().strip()
        products = [p for p in products if needle in _product_searchable_text(p)]
        if not products:
            print(f"ERRORE: nessun prodotto trovato per --only {args.only!r}.", file=sys.stderr)
            sys.exit(1)

    # memoria degli scarti (URL bocciati) e nomi gia' in review: letti PRIMA
    # di sovrascrivere il manifest, cosi' riflettono la run precedente.
    rejected = load_rejections(paths)
    review_names = in_review_basenames(paths)
    n_rejected = sum(len(v) for v in rejected.values())
    if n_rejected:
        print(f"Memoria scarti: {n_rejected} URL/pagine bocciati su "
              f"{len(rejected)} gruppi verranno evitati globalmente.")
    scarti_hash_count = len(load_scarti_hashes_for_base(paths))
    if scarti_hash_count:
        print(f"Memoria visiva scarti: {scarti_hash_count} immagini in _pipeline/scarti verranno bloccate globalmente.")
    if RETRY_SCARTI:
        print("ATTENZIONE: --retry-scarti attivo: i prodotti con file in scarti verranno ritentati, ma le immagini identiche/URL bocciati saranno filtrati.")

    # reset log
    open(paths["log_errors"], "w", encoding="utf-8").close()

    if args.all or args.only:
        subset = products
    else:
        subset = []
        skipped_before_limit = 0
        scanned_total = 0
        for p_ in products:
            scanned_total += 1
            if product_already_handled(p_, paths, review_names):
                skipped_before_limit += 1
                continue
            subset.append(p_)
            if len(subset) >= int(args.limit):
                break
        print(f"Selezione prodotti: letti {scanned_total} record dal JSON, saltati {skipped_before_limit} gia' presenti in public/review/scarti, da processare ora {len(subset)}.")
        if not subset:
            print("Nessun nuovo prodotto da processare: il JSON letto e' gia' coperto da public/immagini, review_images o scarti.")
            print("Se vuoi riprovare anche prodotti finiti in scarti usa: --retry-scarti")
            return

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
    print(f">> CONTROLLA QUI:               {paths['review_dir']}")
    print("   Scegli il candidato buono, rinominalo con il nome finale del JSON, poi spostalo in public/immagini")
    print(f"   Output finale:               {paths['images_dir']}")
    print(f"   Le SCARTE -> spostale in:    {paths['scarti_dir']}")
    print(f"   Report e log:                {paths['pipeline']}")

    print("\n--- 5 esempi pronti in review ---")
    for r in successes:
        print(f"  {r['nome']} -> candidati {os.path.splitext(r['filename_finale'])[0]}.jpg, {os.path.splitext(r['filename_finale'])[0]}2.jpg ... | conf={r['confidence']}")
    print("\n--- 5 casi senza immagine / errore ---")
    for r in doubtful:
        print(f"  {r['nome']} -> {r['status']} | {r['motivo']}")


if __name__ == "__main__":
    main()
