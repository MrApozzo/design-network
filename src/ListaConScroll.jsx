import { useEffect, useState, useRef } from "react"

// Scrollbar personalizzata per le liste di risultati (ricerca, contribuisci):
// un binario chiaro staccato dal riquadro dei risultati, con una "pillola"
// grigia più scura che rappresenta la porzione visibile — niente scrollbar
// nativa del browser, che sui vari sistemi operativi ha un aspetto troppo
// standard e non era possibile staccarla dal contenuto.
export function ListaConScroll({ children, maxHeight, wrapperStyle, innerStyle, className }) {
  const scrollRef = useRef(null)
  const [thumb, setThumb] = useState(null)

  const aggiorna = () => {
    const el = scrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight <= clientHeight + 1) { setThumb(null); return }
    const h = Math.max(24, (clientHeight / scrollHeight) * clientHeight)
    const top = (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - h)
    // setThumb con un oggetto nuovo ad ogni chiamata, dentro un useEffect
    // senza dependency array (sotto): ogni render richiama aggiorna(), che
    // rimanda sempre un oggetto {top,height} diverso per riferimento anche
    // a valori invariati, causando un render successivo all'infinito
    // ("Maximum update depth exceeded"). Aggiorna solo se il valore è
    // davvero cambiato.
    setThumb((prev) => (prev && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.height - h) < 0.5) ? prev : { top, height: h })
  }

  useEffect(() => { aggiorna() })

  return (
    <div style={{ position: "relative", ...wrapperStyle }}>
      <div ref={scrollRef} onScroll={aggiorna} className={`dn-scroll-hidden ${className || ""}`}
        style={{ maxHeight, overflowY: "auto", ...innerStyle }}>
        {children}
      </div>
      {thumb && (
        <div style={{ position: "absolute", top: 6, bottom: 6, right: -13, width: 4, borderRadius: 2, background: "#f0f0f0" }}>
          <div style={{ position: "absolute", top: thumb.top, height: thumb.height, left: 0, right: 0, borderRadius: 2, background: "#b0b0b0" }} />
        </div>
      )}
    </div>
  )
}
