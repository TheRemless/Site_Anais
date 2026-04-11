import "../styles/about.css";

export default function About() {
  return (
    <section id="apropos" className="about">
      <div className="about-container">
        <div className="section-header">
          <span className="section-tag">Mon histoire</span>
          <h2>Salut, moi c'est Anaïs</h2>
          <div className="accent-line"></div>
        </div>

        <div className="about-content">
          <div className="about-image">
            <div className="image-box">
              <div className="image-emoji">🌏</div>
              <p>Photo d'Anaïs</p>
            </div>
            <div className="image-badge">
              Suissesse installée en Thaïlande 🇹🇭
            </div>
          </div>

          <div className="about-text">
            <p>
              Formée à l'École Hôtelière de Genève, j'ai quitté la Suisse à 21 ans pour un voyage de 6 mois à travers l'Asie du Sud-Est. C'est en Thaïlande que mon coeur s'est ancré, séduit par la générosité des habitants, la beauté des paysages et la richesse de la culture.
            </p>
            <p>
              Depuis plus de 2 ans, je vis sur place et j'accompagne les voyageurs francophones dans l'organisation de leur séjour. Mon approche est simple : <strong>transparence totale, zéro commission, et un voyage qui te ressemble.</strong>
            </p>

            <div className="about-features">
              <div className="feature">
                <span className="feature-icon">🎯</span>
                <span>Expertise locale réelle</span>
              </div>
              <div className="feature">
                <span className="feature-icon">🔍</span>
                <span>Transparence totale</span>
              </div>
              <div className="feature">
                <span className="feature-icon">🤝</span>
                <span>Accompagnement humain</span>
              </div>
              <div className="feature">
                <span className="feature-icon">⏰</span>
                <span>Gain de temps garanti</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
