import { SERVICES } from "../data";
import "../styles/services.css";

export default function Services() {
  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section id="services" className="services">
      <div className="services-container">
        <div className="section-header">
          <span className="section-tag">Mes formules</span>
          <h2>Un accompagnement adapté à tes besoins</h2>
          <p>
            Chaque formule inclut un carnet de voyage personnalisé et un accompagnement WhatsApp 7j/7 pendant ton séjour.
          </p>
        </div>

        <div className="services-grid">
          {SERVICES.map((s, i) => (
            <div key={i} className={`service-card ${s.accent ? "accent" : ""}`}>
              {s.accent && <div className="popular-badge">POPULAIRE</div>}

              <div className="service-header">
                <h3>{s.name}</h3>
                <p className="subtitle">{s.subtitle}</p>
              </div>

              <div className="service-price">
                <span className="price-label">dès</span>
                <span className="price">{s.price}</span>
                <span className="price-unit">{s.unit}</span>
              </div>

              <div className="service-features">
                {s.features.map((f, j) => (
                  <div key={j} className="feature-item">
                    <span className="checkmark">✓</span>
                    <span>{f}</span>
                  </div>
                ))}
              </div>

              <p className="service-note">{s.note}</p>

              <button
                className={s.accent ? "btn-primary" : "btn-secondary"}
                onClick={() => scrollTo("contact")}
              >
                Demander un devis gratuit
              </button>
            </div>
          ))}
        </div>

        <div className="other-services">
          <p>
            Aussi disponible : Mini-guides destinations - Cours d'introduction au thaï - Cartes cadeaux voyage
          </p>
        </div>
      </div>
    </section>
  );
}
