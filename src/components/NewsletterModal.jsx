import { useEffect, useRef, useState } from "react";
import "../styles/newsletter-modal.css";

const BREVO_URL =
  "https://771f2f29.sibforms.com/serve/MUIFAGx_OwomkHY5GbDdZZHK0Q69imo8_NJkL9DW7-HJWY3aTJJZTbZAIY3okCXdBFB9gUnbJRsKbFBgfSJTx9a40DAz1wBYozQlRr2btjBm3VtWMK5XXl96Zs1mUe9SE9oN2oHck3ATc5kxWm5qJ2BY-fWKi2uBAU0hbzPcZ-KooLYKkXmWEyiZs2y0FC7K952l9SvkGQMyIl4J";

export default function NewsletterModal({ onClose }) {
  const [loaded, setLoaded] = useState(false);
  const overlayRef = useRef(null);

  // Fermeture avec Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // Clic sur le fond = fermeture
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  return (
    <div
      className="nl-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="S'abonner à la newsletter"
    >
      <div className="nl-modal">
        <button className="nl-close" onClick={onClose} aria-label="Fermer">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {!loaded && (
          <div className="nl-loading">
            <div className="nl-spinner" />
            <p>Chargement…</p>
          </div>
        )}

        <iframe
          src={BREVO_URL}
          className={`nl-iframe ${loaded ? "nl-iframe--ready" : ""}`}
          title="Inscription à la newsletter Zwald Travel Planner"
          onLoad={() => setLoaded(true)}
          frameBorder="0"
          scrolling="auto"
          allowFullScreen
        />
      </div>
    </div>
  );
}
