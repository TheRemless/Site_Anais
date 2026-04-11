import { STATS } from "../data";
import "../styles/hero.css";

export default function Hero() {
  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section id="accueil" className="hero">
      <div className="hero-content">
        <div className="hero-text">
          <div className="hero-tag">TRAVEL PLANNER EN THAÏLANDE</div>
          <h1>
            Ton voyage sur mesure<br/>
            <span className="accent">en Thaïlande & Asie du Sud-Est</span>
          </h1>
          <p>
            Je t'aide à organiser un itinéraire sur mesure, selon tes envies et ton budget, grâce à mon expérience locale. Tu évites les pièges touristiques, tu gagnes du temps, et tu pars l'esprit tranquille.
          </p>
          <div className="hero-buttons">
            <button
              className="btn-primary btn-large"
              onClick={() => scrollTo("contact")}
            >
              Réserver mon appel découverte gratuit
            </button>
            <button
              className="btn-secondary btn-large"
              onClick={() => scrollTo("services")}
            >
              Découvrir mes services
            </button>
          </div>
          <p className="hero-subtext">
            Gratuit et sans engagement - Réponse sous 48h
          </p>
        </div>

        <div className="hero-image">
          <div className="image-placeholder">
            <div className="image-emoji">🇹🇭</div>
            <p>Photo d'Anaïs en Thaïlande</p>
            <p className="small">[Insérer ici une belle photo personnelle]</p>
          </div>
        </div>
      </div>

      <div className="hero-stats">
        {STATS.map((s, i) => (
          <div key={i} className="stat">
            <div className="stat-number">{s.number}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
