import { Link } from "react-router-dom";
import "../styles/pages.css";

export default function APropos() {
  return (
    <div className="page">
      <div className="page-hero page-hero-teal">
        <h1>À propos</h1>
        <p>Travel Planner spécialisée en Thaïlande et Asie du Sud-Est</p>
      </div>

      <section className="page-section">
        <div className="container">
          <div className="two-col">
            <div className="col-photo">
              <img src="/images/IMG_1369.jpg" alt="Anaïs sur une balançoire face à la mer" className="col-img" />
            </div>
            <div className="col-text">
              <h2>Mon parcours</h2>
              <p>
                Je m'appelle Anaïs, une suissesse formée à l'École Hôtelière de Genève,
                pour qui le voyage est devenu plus qu'une passion : une façon de vivre
                et de découvrir le monde.
              </p>
              <p>
                Après avoir obtenu mon diplôme, j'ai décidé de me lancer dans l'aventure
                de ma vie : partir du haut de mes 21 ans avec toutes mes économies,
                6 mois à travers l'Asie du Sud-Est.
              </p>
              <p>
                J'ai pu goûter aux saveurs fraîches de la cuisine vietnamienne, explorer
                les îles paradisiaques de l'Indonésie ou encore m'aventurer dans l'immense
                jungle tropicale de la Malaisie. Mais c'est en Thaïlande, dans le sud du
                pays, que mon cœur s'est ancré, séduit par la gentillesse et la générosité
                des habitants, la beauté des paysages et la richesse de la culture locale.
              </p>
              <p>
                Peu à peu, mes proches m'ont demandé des conseils pour leurs propres voyages.
                J'ai réalisé que mon parcours de vie ici était devenu une ressource précieuse.
                Voyant l'étincelle s'illuminer dans leurs yeux à chaque voyage, c'est de là
                que l'idée de <strong>Zwald Travel Planner</strong> a vu le jour.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section bg-cream">
        <div className="container">
          <div className="two-col" style={{marginBottom: '60px'}}>
            <div className="col-text">
              <h2>La Thaïlande, ma maison</h2>
              <p>
                Après avoir parcouru l'Asie du Sud-Est pendant 6 mois, c'est en Thaïlande
                que j'ai posé mes valises. Je vis ici depuis plus de 2 ans et je découvre
                chaque jour de nouvelles facettes de ce pays incroyable.
              </p>
              <p>
                Les rencontres avec les éléphants, les temples dorés, les marchés locaux,
                les plages secrètes… Ce sont ces expériences authentiques que je veux
                partager avec toi à travers mes itinéraires.
              </p>
            </div>
            <div className="col-photo">
              <img src="/images/IMG_5227.jpg" alt="Anaïs au temple doré en Thaïlande" className="col-img" />
            </div>
          </div>
          <h2 className="text-center">Ma vision du voyage</h2>
          <div className="values-grid">
            <div className="value-item">
              <p>Chaque voyageur est unique</p>
            </div>
            <div className="value-item">
              <p>Chaque voyage mérite une organisation sur mesure</p>
            </div>
            <div className="value-item">
              <p>Un bon voyage commence bien avant le départ</p>
            </div>
          </div>
          <div className="prose">
            <p>
              Je ne propose pas de circuits standardisés, ni de solutions toutes faites.
              Je prends le temps de comprendre tes envies, ton rythme, ton budget et ta
              façon de voyager, pour construire un itinéraire cohérent et adapté à la
              réalité du terrain.
            </p>
          </div>
        </div>
      </section>

      <section className="page-section">
        <div className="container">
          <h2 className="text-center">Pourquoi me faire confiance ?</h2>
          <div className="trust-grid">
            <div className="trust-card">
              <h3>Expertise locale réelle</h3>
              <p>Je vis en Asie et je connais les réalités du terrain, au-delà des guides et des blogs généralistes.</p>
            </div>
            <div className="trust-card">
              <h3>Transparence totale</h3>
              <p>Je ne fais pas de réservations et je ne touche aucune commission. Tu sais exactement ce que tu paies et pourquoi.</p>
            </div>
            <div className="trust-card">
              <h3>Accompagnement humain</h3>
              <p>Je reste disponible avant, pendant et après ton voyage. Tu n'es jamais seul(e) face aux imprévus.</p>
            </div>
            <div className="trust-card">
              <h3>Gain de temps et sérénité</h3>
              <p>Je t'évite des heures de recherches, d'hésitations et de doutes.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section bg-teal text-white text-center">
        <div className="container">
          <h2>Envie de partir l'esprit tranquille ?</h2>
          <p style={{maxWidth: '600px', margin: '0 auto 32px', opacity: 0.95}}>
            Si tu as envie d'un itinéraire construit pour toi, qui respecte ton budget,
            avec une personne de confiance à tes côtés, je serais ravie de t'accompagner.
          </p>
          <Link to="/contact#formulaire" className="btn-white btn-large">Me contacter</Link>
        </div>
      </section>
    </div>
  );
}
