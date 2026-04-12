import { Link } from "react-router-dom";
import "../styles/pages.css";

export default function Services() {
  return (
    <div className="page">
      <div className="page-hero page-hero-teal">
        <h1>Mes services</h1>
        <p>Organisation de voyages sur mesure en Thaïlande et Asie du Sud-Est</p>
      </div>

      {/* Intro */}
      <section className="page-section">
        <div className="container">
          <div className="prose-wide">
            <p className="lead" style={{textAlign: 'center', marginBottom: '32px'}}>
              Organiser un voyage en Thaïlande ou en Asie du Sud-Est demande du temps, des recherches
              fiables et une bonne compréhension du terrain. Mon rôle de Travel Planner est de t'accompagner
              et te guider dans cette planification grâce à un carnet de voyage personnalisé, clair et structuré,
              tout en te laissant totalement libre de tes réservations.
            </p>
          </div>
        </div>
      </section>

      {/* Qu'est-ce qu'un Travel Planner */}
      <section className="page-section bg-cream">
        <div className="container">
          <h2 className="text-center">Qu'est-ce qu'un Travel Planner ?</h2>
          <div className="prose" style={{textAlign: 'center', marginBottom: '32px'}}>
            <p>
              Un Travel Planner est un conseiller en organisation de voyage qui t'aide à vivre des
              expériences personnalisées. Il t'aide à construire un itinéraire sur mesure, à faire les
              bons choix et à éviter les erreurs courantes, tout en respectant ton budget et ton style de voyage.
            </p>
          </div>
          <div className="feature-grid">
            <div className="feature-item">✅ Tu sais exactement ce que tu paies</div>
            <div className="feature-item">🔑 Tu gardes la main sur toutes les réservations</div>
            <div className="feature-item">⏰ Tu gagnes du temps et t'évites le stress de la planification</div>
            <div className="feature-item">🛡️ Tu évites les pièges à touristes et erreurs fréquentes</div>
            <div className="feature-item">💰 Tu voyages en respectant ton budget</div>
            <div className="feature-item">🤝 Tu bénéficies d'un accompagnement humain continu</div>
          </div>
        </div>
      </section>

      {/* Carnet de voyage */}
      <section className="page-section">
        <div className="container">
          <h2 className="text-center">Le carnet de voyage</h2>
          <div className="prose" style={{textAlign: 'center', marginBottom: '32px'}}>
            <p>
              Chaque voyage est unique. Je crée pour toi un carnet de voyage digital complet
              et personnalisé, qui devient ton guide avant et pendant ton séjour.
            </p>
          </div>
          <div className="feature-grid">
            <div className="feature-item">📅 Un itinéraire jour par jour avec des propositions d'activités</div>
            <div className="feature-item">🏨 Tes réservations de transports, hébergements et activités</div>
            <div className="feature-item">🎯 Des recommandations adaptées à ton profil</div>
            <div className="feature-item">🔗 Tous les liens utiles pour réserver facilement</div>
            <div className="feature-item">📝 Des conseils pratiques et culturels</div>
            <div className="feature-item">💡 Mes astuces locales pour voyager sereinement</div>
          </div>
        </div>
      </section>

      {/* Ce qui est inclus */}
      <section className="page-section bg-cream">
        <div className="container">
          <div className="two-col">
            <div className="col-text">
              <h2>Ce qui est inclus</h2>
              <div className="feature-grid" style={{gridTemplateColumns: '1fr'}}>
                <div className="feature-item">Échange initial pour comprendre ton projet</div>
                <div className="feature-item">Appel découverte gratuit</div>
                <div className="feature-item">Propositions d'itinéraires personnalisés selon ton budget et ton rythme</div>
                <div className="feature-item">Sélection d'hébergements et transports adaptés</div>
                <div className="feature-item">Suggestions d'activités et d'expériences locales</div>
                <div className="feature-item">Tous les liens de réservation</div>
                <div className="feature-item">Carnet de voyage digital complet</div>
                <div className="feature-item">Support avant et pendant ton voyage</div>
                <div className="feature-item">Assistance WhatsApp 7j/7 pendant ton séjour</div>
              </div>
            </div>
            <div className="col-text">
              <h2>Ce qui n'est pas inclus</h2>
              <div className="feature-grid" style={{gridTemplateColumns: '1fr'}}>
                <div className="feature-item">Réservations (vols, hôtels, activités)</div>
                <div className="feature-item">Assurances et visas</div>
                <div className="feature-item">Prestations sur place (guides, chauffeurs, excursions)</div>
              </div>
              <p style={{marginTop: '16px', fontSize: '0.93rem', color: 'var(--text-medium)', lineHeight: '1.7'}}>
                Ce qui garantit : liberté de tes choix et aucun frais caché.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Formules */}
      <section className="page-section">
        <div className="container">
          <h2 className="text-center">Mes formules de voyage</h2>
          <div className="trust-grid" style={{marginBottom: '40px'}}>
            {/* Solo/Duo */}
            <div className="trust-card" style={{borderLeft: '4px solid var(--accent)'}}>
              <h3>Formule Solo / Duo</h3>
              <p style={{fontSize: '0.85rem', color: 'var(--primary)', fontWeight: '600', marginBottom: '12px'}}>
                Jusqu'à 2 personnes — ~40 CHF/jour
              </p>
              <p>
                Idéale pour un voyage à deux ou en solo, avec un accompagnement complet.
                Support avant et pendant le voyage, jusqu'à 3 villes (supplément possible),
                sélection de 2-3 vols ou transports par étape, sélection de 3-4 hébergements par ville,
                large choix d'activités, conseils personnalisés et carnet de voyage sur mesure.
              </p>
            </div>

            {/* Famille */}
            <div className="trust-card" style={{borderLeft: '4px solid var(--accent)'}}>
              <h3>Formule Famille</h3>
              <p style={{fontSize: '0.85rem', color: 'var(--primary)', fontWeight: '600', marginBottom: '12px'}}>
                Jusqu'à 4 personnes — ~43 CHF/jour
              </p>
              <p>
                Pensée pour voyager en famille ou en petit groupe en toute sérénité.
                Support avant et pendant le voyage, jusqu'à 3 villes, sélection de transports
                et hébergements, activités adaptées aux enfants et groupes, conseils personnalisés
                et carnet de voyage sur mesure. Supplément possible par personne supplémentaire.
              </p>
            </div>

            {/* Light */}
            <div className="trust-card" style={{borderLeft: '4px solid var(--accent)'}}>
              <h3>Formule Light</h3>
              <p style={{fontSize: '0.85rem', color: 'var(--primary)', fontWeight: '600', marginBottom: '12px'}}>
                Pour les voyageurs autonomes — dès 29 CHF/jour
              </p>
              <p>
                Idéale si tu veux surtout des idées d'activités et conseils sur la culture et la vie locale.
                Support avant et pendant le voyage, jusqu'à 3 villes, large sélection d'activités,
                conseils et recommandations personnalisés, carnet de voyage sur mesure.
                Pas de sélection de transports/hébergements (possible en supplément).
              </p>
            </div>
          </div>

          <div className="prose" style={{textAlign: 'center'}}>
            <p style={{fontSize: '0.93rem', color: 'var(--text-medium)'}}>
              Tu ne trouves pas la formule qui te correspond ? Tu préfères une formule « par région »,
              tu projettes un voyage de groupe, une lune de miel, un anniversaire ou un voyage surprise ?
              Contacte-moi pour recevoir ton devis gratuitement, je m'adapte à ton projet !
            </p>
          </div>
        </div>
      </section>

      {/* À qui s'adresse ce service */}
      <section className="page-section bg-cream">
        <div className="container">
          <h2 className="text-center">Ce service est fait pour toi si...</h2>
          <div className="feature-grid">
            <div className="feature-item">🌍 Tu souhaites un voyage vraiment personnalisé</div>
            <div className="feature-item">⏳ Tu manques de temps pour tout organiser</div>
            <div className="feature-item">🧭 Tu ne sais pas par où commencer la planification</div>
            <div className="feature-item">🛡️ Tu as peur de tomber dans les pièges touristiques</div>
            <div className="feature-item">🤝 Tu recherches un accompagnement humain et fiable</div>
            <div className="feature-item">✈️ Tu souhaites voyager sereinement en gardant la main</div>
          </div>
        </div>
      </section>

      {/* Processus */}
      <section className="page-section">
        <div className="container">
          <h2 className="text-center">Comment se déroule l'accompagnement</h2>
          <div className="faq-list">
            {[
              { num: "1", title: "Prise de contact", desc: "Contacte-moi par email, via le formulaire de contact ou sur mes réseaux afin de me faire part de ton envie de voyage et me poser toutes tes questions." },
              { num: "2", title: "Questionnaire de voyage", desc: "Je t'invite à remplir un court questionnaire pour mieux comprendre ton projet : dates, destinations, activités, budget, nombre de participants, préférences…" },
              { num: "3", title: "Appel découverte", desc: "Gratuit et sans engagement. Je te contacte pour planifier un appel afin de discuter de vive voix de tes besoins et envies, et t'expliquer mes services et formules." },
              { num: "4", title: "Itinéraire sur-mesure et devis", desc: "Après notre échange, je commence à élaborer une première version de ton itinéraire sur-mesure, en tenant compte de tes demandes et budget. Tu recevras également un devis." },
              { num: "5", title: "Conception du voyage", desc: "Une fois le devis validé et réglé, je me lance dans la recherche, comparaison et sélection des meilleures options : transports, hébergements et demandes spécifiques." },
              { num: "6", title: "Réservations", desc: "Je te fournis les liens directs pour effectuer tes réservations en toute autonomie. Aucune obligation, tu es libre de tous tes choix !" },
              { num: "7", title: "Carnet de voyage", desc: "Une fois les réservations effectuées, je crée ton carnet de voyage personnalisé contenant ton itinéraire détaillé, tes réservations, des propositions d'activités jour par jour et mes recommandations." },
              { num: "8", title: "C'est parti !", desc: "Profite de ton voyage sans stress ! Si tu as des questions pendant ton voyage, je suis toujours là pour t'aider et te fournir des conseils via WhatsApp 7j/7." }
            ].map((step, i) => (
              <div className="faq-item" key={i} style={{display: 'flex', gap: '20px', alignItems: 'flex-start'}}>
                <span style={{
                  fontSize: '1.6rem',
                  fontWeight: '900',
                  color: 'var(--primary)',
                  opacity: 0.3,
                  lineHeight: 1,
                  flexShrink: 0,
                  width: '36px',
                  textAlign: 'center'
                }}>{step.num}</span>
                <div>
                  <h3 style={{marginBottom: '8px'}}>{step.title}</h3>
                  <p>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Autres services */}
      <section className="page-section bg-cream">
        <div className="container">
          <h2 className="text-center">Mes autres services</h2>
          <div className="trust-grid">
            <div className="trust-card">
              <h3>Mini-guides PDF</h3>
              <p>
                Un premier pas simple pour trouver de l'inspiration et des infos utiles pour ton
                prochain voyage : où aller, quoi faire, quoi goûter et quelles adresses noter.
                Infos fiables, conseils terrain et recommandations honnêtes grâce à mon expérience
                sur place. PDF envoyé par email après paiement (montant libre).
              </p>
            </div>
            <div className="trust-card">
              <h3>Cours d'introduction au thaï</h3>
              <p>
                Un cours en ligne d'environ 60 min avec un local de Koh Lanta, accessible à tous :
                adultes, couples, familles et enfants. Des cours ludiques et utiles pour dire tes
                premiers mots en thaï et mieux comprendre la culture locale. 15 CHF par session.
              </p>
              <Link to="/cours-thai" style={{display: 'inline-block', marginTop: '12px', color: 'var(--primary)', fontWeight: '600', textDecoration: 'none'}}>
                En savoir plus →
              </Link>
            </div>
            <div className="trust-card">
              <h3>Cartes cadeaux voyage</h3>
              <p>
                100% personnalisables (montant, nom, message, thème). Elles donnent accès à un
                accompagnement complet pour organiser un voyage sur mesure. Idéal pour un anniversaire,
                un mariage, Noël ou un cadeau commun.
              </p>
              <Link to="/contact#formulaire" style={{display: 'inline-block', marginTop: '12px', color: 'var(--primary)', fontWeight: '600', textDecoration: 'none'}}>
                Commander une carte →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="page-section bg-teal text-white text-center">
        <div className="container">
          <h2>Alors, on y va ?</h2>
          <div className="prose" style={{textAlign: 'center'}}>
            <p style={{color: 'rgba(255,255,255,0.85)'}}>
              Je te propose un appel découverte (100% gratuit et sans engagement) pour discuter
              de ton projet et voir comment je peux t'accompagner.
            </p>
          </div>
          <Link to="/contact#formulaire" className="btn-white btn-large" style={{marginTop: '24px'}}>
            Réserver mon appel gratuit
          </Link>
        </div>
      </section>

      <section className="page-section" style={{textAlign: 'center'}}>
        <div className="container">
          <h2>Prépare ton voyage avec confiance</h2>
          <div className="prose" style={{textAlign: 'center', maxWidth: '600px', margin: '0 auto 24px'}}>
            <p>
              Rejoins ma newsletter pour recevoir mes derniers conseils, astuces et
              recommandations locales directement dans ta boîte mail. Aucun spam, promis !
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
