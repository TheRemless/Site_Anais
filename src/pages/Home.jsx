import { useState } from "react";
import { Link } from "react-router-dom";
import "../styles/home.css";


const TESTIMONIALS = [
  {
    name: "Sophie",
    trip: "Koh Lanta",
    text: "Un immense merci à Anaïs ! Elle a vraiment pris le temps de comprendre mes envies et a su transformer mes attentes en un voyage sur-mesure absolument parfait. Elle connaît tous les meilleurs plans : restaurants locaux, excursions au top, activités à prix imbattables… Résultat : j'ai profité de vacances exceptionnelles tout en faisant de belles économies !"
  },
  {
    name: "Timothé",
    trip: "Bali, Lombok & Indonésie",
    text: "Anaïs nous a concocté un voyage sur-mesure en Indonésie que nous n'oublierons pas ! Elle a su écouter nos attentes et préparer le voyage que nous souhaitions en mariant aventures, découvertes, proximité avec les locaux et repos. Ses recommandations nous ont permis de voyager sans prise de tête."
  },
  {
    name: "Patrick",
    trip: "Koh Lanta & Bangkok",
    text: "Grâce aux précieux conseils d'Anaïs nous avons découvert l'île de Koh Lanta avec ses coins luxuriants, sa gastronomie riche et sa population souriante. L'expérience de faire appel à une Travel Planner a été incroyable, garant de gain de temps et d'argent !"
  },
  {
    name: "Céline",
    trip: "Thaïlande",
    text: "Anaïs nous a permis de passer un voyage de rêve qui correspondait parfaitement à nos attentes. Avec elle tout fonctionne, vous pouvez lui faire pleinement confiance ! Elle aura toujours le don de vous surprendre et de vous faire plaisir."
  }
];

const STEPS = [
  { num: "01", title: "Prise de contact", desc: "Tu me racontes ton projet de voyage par email, formulaire ou réseaux sociaux." },
  { num: "02", title: "Appel découverte", desc: "Gratuit et sans engagement. On échange sur tes envies, ton budget et tes dates." },
  { num: "03", title: "Itinéraire sur-mesure", desc: "Je prépare une ou deux propositions adaptées à ton projet, avec un devis." },
  { num: "04", title: "Conception du voyage", desc: "Sélection de transports, hébergements et activités adaptés à ton style." },
  { num: "05", title: "Carnet de voyage", desc: "Tu reçois ton guide complet avec toutes les infos pour réserver et voyager sereinement." },
  { num: "06", title: "Bon voyage !", desc: "Je reste disponible 7j/7 pendant ton séjour. Toi, tu n'as plus qu'à profiter !" }
];

function TestimonialsCarousel({ testimonials }) {
  const [current, setCurrent] = useState(0);
  const total = testimonials.length;
  const prev = () => setCurrent((current - 1 + total) % total);
  const next = () => setCurrent((current + 1) % total);

  const getIndex = (offset) => (current + offset + total) % total;

  return (
    <section className="testimonials">
      <div className="container">
        <h2>Ce que disent mes voyageurs</h2>
        <div className="carousel-wrapper">
          <button className="carousel-btn carousel-prev" onClick={prev} aria-label="Précédent">‹</button>

          <div className="carousel-track">
            {[-1, 0, 1].map((offset) => {
              const idx = getIndex(offset);
              const t = testimonials[idx];
              const isCenter = offset === 0;
              return (
                <div
                  key={`${offset}-${idx}`}
                  className={`testimonial-card ${isCenter ? 'card-center' : 'card-side'}`}
                >
                  <div className="testimonial-quote">"</div>
                  <p className="testimonial-text">{t.text}</p>
                  <div className="testimonial-author">
                    <strong>{t.name}</strong>
                    <span>{t.trip}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <button className="carousel-btn carousel-next" onClick={next} aria-label="Suivant">›</button>
        </div>
        <div className="carousel-dots">
          {testimonials.map((_, i) => (
            <button
              key={i}
              className={`carousel-dot ${i === current ? 'active' : ''}`}
              onClick={() => setCurrent(i)}
              aria-label={`Avis ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div className="home">

      {/* ============ HERO ============ */}
      <section className="hero">
        <div className="hero-bg-image" style={{backgroundImage: 'url(/images/IMG_6422.jpg)'}} />
        <div className="hero-overlay" />
        <div className="hero-inner">
          <p className="hero-tag">Travel Planner en Thaïlande & Asie du Sud-Est</p>
          <h1>Voyages sur mesure,<br/>pensés pour toi</h1>
          <p className="hero-sub">
            Je t'aide à organiser ton itinéraire sur-mesure, selon tes envies et ton budget
            grâce à mon expérience locale — et je t'évite de perdre un temps précieux,
            sans que cela te coûte plus cher !
          </p>
          <div className="hero-btns">
            <Link to="/contact#formulaire" className="btn-primary btn-large">Recevoir mon devis gratuitement</Link>
            <Link to="/services" className="btn-white btn-large">Découvrir mes services</Link>
          </div>
        </div>
      </section>

      {/* ============ INTRO / À PROPOS ============ */}
      <section className="intro">
        <div className="container">
          <div className="intro-content">
            <div className="intro-photo">
              <img src="/images/IMG_5300.jpg" alt="Anaïs avec un éléphant en Thaïlande" className="intro-img" />
            </div>
            <div className="intro-text">
              <h2>Bienvenue ! Moi c'est Anaïs</h2>
              <p>
                Je suis Travel Planner spécialisée en Thaïlande. Je vis en Thaïlande
                depuis plus de 3 ans et j'aide les voyageurs francophones à organiser
                leur séjour en toute simplicité et sérénité.
              </p>
              <p>
                Organiser un voyage en Thaïlande ou en Asie du Sud-Est peut vite devenir
                complexe : choix des régions, saisons, transports, hébergements, activités…
                Mon rôle est de transformer ton projet en un itinéraire clair, adapté à ton
                style de voyage, à ton budget et à tes envies.
              </p>
              <Link to="/a-propos" className="btn-secondary">En savoir plus sur mon parcours</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ============ À QUI S'ADRESSE ============ */}
      <section className="audience">
        <div className="container">
          <h2>Mon service est idéal si...</h2>
          <div className="audience-grid">
            <div className="audience-card">
              <span className="audience-icon">🧭</span>
              <p>Tu veux organiser un voyage en Thaïlande mais tu ne sais pas par où commencer</p>
            </div>
            <div className="audience-card">
              <span className="audience-icon">🛡️</span>
              <p>Tu veux éviter les erreurs que font la plupart des touristes</p>
            </div>
            <div className="audience-card">
              <span className="audience-icon">💎</span>
              <p>Tu veux découvrir des endroits authentiques et des bonnes adresses locales</p>
            </div>
            <div className="audience-card">
              <span className="audience-icon">🗓️</span>
              <p>Tu veux un voyage bien organisé tout en gardant la liberté de tes choix</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============ PHOTO GALLERY STRIP ============ */}
      <section className="photo-strip">
        <div className="photo-strip-inner">
          <img src="/images/IMG_5519.jpg" alt="Temple blanc, Chiang Rai" />
          <img src="/images/FullSizeRender.jpg" alt="Singe sur la plage, Krabi" />
          <img src="/images/IMG_6424.jpg" alt="Canal de Bangkok avec Bouddha doré" />
          <img src="/images/IMG_9507.jpg" alt="Rencontre avec un éléphant" />
          <img src="/images/IMG_2016.jpg" alt="Coucher de soleil sur la plage" />
        </div>
      </section>

      {/* ============ POURQUOI MOI ============ */}
      <section className="why-me">
        <div className="container">
          <h2>Pourquoi faire appel à une Travel Planner ?</h2>
          <div className="why-grid">
            <div className="why-card">
              <div className="why-icon">✨</div>
              <h3>Voyage 100% sur mesure</h3>
              <p>Pas de circuit standardisé. Ton itinéraire est construit spécifiquement pour toi,
                que tu voyages en couple, en famille ou en solo.</p>
            </div>
            <div className="why-card">
              <div className="why-icon">📖</div>
              <h3>Carnet de voyage personnalisé</h3>
              <p>Tu reçois un carnet digital clair avec ton itinéraire, tous les liens pour réserver,
                une sélection d'activités, des conseils pratiques et culturels.</p>
            </div>
            <div className="why-card">
              <div className="why-icon">💬</div>
              <h3>Accompagnement continu</h3>
              <p>Je reste disponible pour toi, du premier message jusqu'à la fin de ton séjour.
                Assistance WhatsApp 7j/7 pendant ton voyage.</p>
            </div>
            <div className="why-card">
              <div className="why-icon">🔍</div>
              <h3>Transparence totale</h3>
              <p>Je ne fais pas de réservations et je ne touche aucune commission.
                Tu sais exactement ce que tu paies et pourquoi.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FORMULES ============ */}
      <section className="formules">
        <div className="container">
          <h2>Mes formules de voyage</h2>
          <p className="section-subtitle">Chaque voyage est unique. Choisis la formule qui te correspond.</p>
          <div className="formules-grid">
            <div className="formule-card">
              <div className="formule-badge">Populaire</div>
              <h3>Formule Solo / Duo</h3>
              <p className="formule-audience">Jusqu'à 2 personnes</p>
              <div className="formule-price">~40 CHF <span>par jour de voyage organisé</span></div>
              <ul>
                <li>Support avant et pendant le voyage</li>
                <li>Jusqu'à 3 villes (supplément possible)</li>
                <li>2-3 vols ou transports par étape</li>
                <li>3-4 hébergements par ville</li>
                <li>Large choix d'activités par ville</li>
                <li>Conseils et recommandations personnalisés</li>
                <li>Carnet de voyage sur mesure</li>
              </ul>
              <Link to="/contact#formulaire" className="btn-primary">Recevoir un devis</Link>
            </div>

            <div className="formule-card">
              <h3>Formule Famille</h3>
              <p className="formule-audience">Jusqu'à 4 personnes — adaptée aux enfants</p>
              <div className="formule-price">~43 CHF <span>par jour de voyage organisé</span></div>
              <ul>
                <li>Support avant et pendant le voyage</li>
                <li>Jusqu'à 3 villes (supplément possible)</li>
                <li>2-3 vols ou transports par étape</li>
                <li>3-4 hébergements par ville</li>
                <li>Activités adaptées aux enfants/groupes</li>
                <li>Conseils et recommandations personnalisés</li>
                <li>Carnet de voyage sur mesure</li>
              </ul>
              <Link to="/contact#formulaire" className="btn-primary">Recevoir un devis</Link>
            </div>

            <div className="formule-card">
              <h3>Formule Light</h3>
              <p className="formule-audience">Voyageurs autonomes</p>
              <div className="formule-price">dès 29 CHF <span>par jour de voyage organisé</span></div>
              <ul>
                <li>Support avant et pendant le voyage</li>
                <li>Jusqu'à 3 villes (supplément possible)</li>
                <li>Large sélection d'activités par ville</li>
                <li>Conseils et recommandations personnalisés</li>
                <li>Carnet de voyage sur mesure</li>
              </ul>
              <Link to="/contact#formulaire" className="btn-primary">Recevoir un devis</Link>
            </div>
          </div>
          <p className="formule-note">
            Tu ne trouves pas la formule qui te correspond ? Voyage de groupe, lune de miel,
            anniversaire, voyage surprise ? <Link to="/contact#formulaire">Contacte-moi</Link> pour un devis gratuit !
          </p>
        </div>
      </section>

      {/* ============ COMMENT ÇA MARCHE ============ */}
      <section className="process">
        <div className="container">
          <h2>Comment ça marche</h2>
          <div className="process-grid">
            {STEPS.map((step, i) => (
              <div key={i} className="process-step">
                <div className="step-num">{step.num}</div>
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ TÉMOIGNAGES CAROUSEL ============ */}
      <TestimonialsCarousel testimonials={TESTIMONIALS} />

      {/* ============ AUTRES SERVICES ============ */}
      <section className="other-services">
        <div className="container">
          <h2>Mes autres services</h2>
          <div className="other-grid">
            <div className="other-card">
              <span className="other-emoji">🇹🇭</span>
              <h3>Cours d'introduction au thaï</h3>
              <p>Un cours en ligne d'environ 60 min avec Bank, un local de Koh Lanta.
                Apprends les bases pour te débrouiller et impressionner les locaux !</p>
              <p className="other-price">15 CHF / cours</p>
              <Link to="/cours-thai" className="btn-secondary">En savoir plus</Link>
            </div>
            <div className="other-card">
              <span className="other-emoji">🎁</span>
              <h3>Cartes cadeaux voyage</h3>
              <p>Anniversaire, mariage, Noël… Offre un accompagnement voyage complet
                avec une carte cadeau 100% personnalisable.</p>
              <p className="other-price">Montant au choix</p>
              <Link to="/contact" className="btn-secondary">Commander</Link>
            </div>
            <div className="other-card">
              <span className="other-emoji">📚</span>
              <h3>Mini-guides PDF</h3>
              <p>Inspiration et infos utiles : où aller, quoi faire, quoi goûter et
                quelles adresses noter. Un guide local dans ta poche.</p>
              <p className="other-price">Montant libre</p>
              <Link to="/contact" className="btn-secondary">Découvrir</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ============ CTA FINAL ============ */}
      <section className="cta-final">
        <div className="container">
          <h2>Prêt(e) à organiser ton voyage ?</h2>
          <p>Tu rêves d'un voyage en Thaïlande ou en Asie du Sud-Est sans stress et
            parfaitement organisé ? Je t'aide à créer un séjour personnalisé qui te
            ressemble, sans faire exploser ton budget.</p>
          <div className="cta-btns">
            <Link to="/contact#formulaire" className="btn-white btn-large">Me contacter</Link>
            <Link to="/services" className="btn-secondary btn-large" style={{borderColor: 'white', color: 'white'}}>
              Voir mes services
            </Link>
          </div>
        </div>
      </section>

      {/* ============ NEWSLETTER (MailerLite) ============ */}
      <section className="newsletter">
        <div className="container">
          <h3>Prépare ton voyage avec confiance et sérénité</h3>
          <p>J'ai créé une newsletter dans laquelle je partage régulièrement des nouveautés,
            des promotions en avant-première, des conseils et astuces de voyage, ainsi que
            mes meilleures adresses et recommandations locales. Aucun spam, promis !</p>
          <div className="ml-embedded" data-form="Ew3n64"></div>
        </div>
      </section>
    </div>
  );
}
