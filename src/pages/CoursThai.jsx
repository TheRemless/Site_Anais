import { Link } from "react-router-dom";
import "../styles/pages.css";

export default function CoursThai() {
  return (
    <div className="page">
      <div className="page-hero page-hero-teal">
        <h1>Cours d'introduction au thaï</h1>
        <p>Un cours en ligne d'environ 60 min avec un local de Koh Lanta</p>
      </div>

      <section className="page-section">
        <div className="container">
          <div className="prose-wide">
            <p className="lead">
              Ce cours d'introduction au thaï est conçu pour les futurs voyageurs, les familles,
              couples ou les personnes qui souhaitent partir vivre ou travailler en Thaïlande.
              En une petite heure, tu apprends quelques phrases essentielles, les chiffres,
              les bases de politesse et les règles culturelles pour te débrouiller dès ton arrivée
              et impressionner les locaux !
            </p>
          </div>
        </div>
      </section>

      <section className="page-section bg-cream">
        <div className="container">
          <h2 className="text-center">Ce que tu apprendras</h2>
          <div className="feature-grid">
            <div className="feature-item">🙏 Saluer, remercier et t'excuser correctement</div>
            <div className="feature-item">🔢 Comprendre et utiliser les chiffres (prix, chambres)</div>
            <div className="feature-item">💰 Demander un prix ou l'addition</div>
            <div className="feature-item">🍜 Commander simplement au restaurant</div>
            <div className="feature-item">🏛️ Connaître les règles de politesse et coutumes locales</div>
            <div className="feature-item">❓ Poser toutes tes questions sur la vie quotidienne</div>
          </div>
        </div>
      </section>

      <section className="page-section">
        <div className="container">
          <h2 className="text-center">Comment se déroule le cours</h2>
          <div className="info-grid">
            <div className="info-card">
              <strong>Durée</strong>
              <p>Environ 60 minutes</p>
            </div>
            <div className="info-card">
              <strong>Format</strong>
              <p>En ligne (WhatsApp ou Google Meet)</p>
            </div>
            <div className="info-card">
              <strong>Langue</strong>
              <p>Anglais basic + Anaïs pour les traductions en français</p>
            </div>
            <div className="info-card">
              <strong>Participants</strong>
              <p>Individuel, couple ou famille (même prix)</p>
            </div>
            <div className="info-card">
              <strong>Niveau</strong>
              <p>Débutants — aucune base nécessaire</p>
            </div>
            <div className="info-card">
              <strong>Bonus</strong>
              <p>PDF inclus avec thaï en "karaoké" + traductions FR</p>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section bg-cream">
        <div className="container">
          <div className="two-col">
            <div className="col-text">
              <h2>Animé par Bank, local de Koh Lanta</h2>
              <p>
                Le cours est animé par Bank, un Thaïlandais de la région de Krabi, ancien
                professeur, habitué à enseigner et communiquer avec des étrangers.
              </p>
              <p>
                Il connaît les difficultés des voyageurs et explique de façon simple, claire
                et pratique. L'objectif n'est pas de parl˜er parfaitement, mais d'apprendre
                de façon ludique pour essayer de communiquer avec les locaux une fois sur
                place — et les impressionner !
              </p>
            </div>
            <div className="col-photo">
              <img src="/images/Bank.jpg" alt="Bank est professeur de Thaï pour étrangers et enfants" className="col-img" />
            </div>
          </div>
        </div>
      </section>

      <section className="page-section bg-teal text-white text-center">
        <div className="container">
          <h2>15 CHF pour le cours d'une heure</h2>
          <div className="price-details">
            <p>PDF inclus — Même prix seul, en couple ou en famille — Sans engagement</p>
            <p>Tarif dégressif pour plusieurs sessions — <strong>-10% pour les clients Zwald Travel Planner</strong></p>
          </div>
          <Link to="/contact#formulaire" className="btn-white btn-large" style={{marginTop: '24px'}}>
            Réserver un créneau
          </Link>
        </div>
      </section>
    </div>
  );
}
