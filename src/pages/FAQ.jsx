import { useState } from "react";
import { Link } from "react-router-dom";
import "../styles/pages.css";

const FAQS = [
  {
    question: "Quelle est la différence entre une Travel Planner et une agence de voyage ?",
    answer: "Une Travel Planner ne vend pas de prestations et ne prend aucune commission sur les hôtels, activités ou transports. Mon rôle est de vous guider et vous accompagner. Je conçois votre itinéraire sur mesure selon vos envies, vous conseille selon mon expérience terrain en Thaïlande et en Asie du Sud-Est, puis vous laisse libre choix de vos réservations, à effectuer directement auprès des prestataires, sans frais cachés. Cela vous garantit liberté, transparence et contrôle total sur votre budget."
  },
  {
    question: "Est-ce que tu réserves les vols et les hébergements ?",
    answer: "Je ne réalise pas les réservations à ta place. Je te fais une sélection personnalisée et te recommande les meilleures options selon ton budget, ta période et tes besoins. Tu reçois des liens précis et des conseils clairs et transparents, afin de pouvoir réserver en toute confiance, sur des plateformes fiables ou auprès des prestataires locaux directement."
  },
  {
    question: "Combien de temps à l'avance faut-il préparer un voyage en Thaïlande ?",
    answer: "Je recommande idéalement de commencer à planifier 6 mois minimum avant le départ, surtout pour les périodes de vacances scolaires qui sont très demandées. Cependant, il est possible d'organiser un voyage plus tardivement selon la période du séjour et votre budget. Les vols internationaux sont à réserver 6 mois à un an à l'avance afin de bénéficier des meilleurs prix. Viennent ensuite la sélection des hébergements à effectuer au plus tôt pour avoir plus de choix et disponibilités. Les activités et autres transports peuvent se réserver quelques semaines à l'avance, voire même sur place."
  },
  {
    question: "Pour quel type de voyageurs proposes-tu des itinéraires ?",
    answer: "J'accompagne principalement des couples, des familles avec jeunes enfants et ados, ainsi que des voyageurs solo ou digital nomads — allant des voyages petit budget, au milieu ou haut de gamme, en passant par les grands événements (anniversaire, anniversaire de mariage…). Chaque itinéraire est entièrement personnalisé selon les envies, le rythme et le budget du client. Je limite volontairement les places pour pouvoir personnaliser au maximum l'expérience de chacun de mes clients et être disponible pour eux 7 jours sur 7."
  },
  {
    question: "Pourquoi faire appel à une Travel Planner si je peux organiser mon voyage seul ?",
    answer: "Organiser un voyage demande du temps, de l'énergie et beaucoup de recherches. Entre les milliers d'informations disponibles, les avis contradictoires et les réseaux sociaux, il est facile de s'y perdre. En faisant appel à moi, tu gagnes du temps (je prends en charge les heures de recherches et d'optimisation), tu bénéficies d'une expertise terrain (je vis sur place), tu évites les pièges touristiques, ton itinéraire est pensé pour toi (pas de copier-coller), et tu pars sereinement avec un plan clair et structuré."
  },
  {
    question: "Combien coûte un voyage sur mesure avec toi ?",
    answer: "Mon accompagnement fonctionne sous forme de forfaits. Le tarif dépend de la durée du voyage, du nombre de voyageurs et du niveau de personnalisation souhaité. Je m'adapte à ton voyage en proposant des formules plus ou moins encadrées. Le tarif couvre la conception complète de ton itinéraire, les sélections de transports et d'hébergements, les suggestions d'activités, les conseils personnalisés, ainsi que le suivi avant et durant ton voyage. Chaque projet est unique, c'est pourquoi je propose un devis personnalisé (gratuit et sans engagement) après un premier échange. Aucune commission n'est perçue sur tes réservations."
  },
  {
    question: "Puis-je te contacter si j'ai déjà réservé une partie de mon voyage ?",
    answer: "Oui, tout à fait. Je peux analyser ton itinéraire actuel et proposer des ajustements, ou ne t'accompagner que pour une partie ou région de ton séjour si tu le souhaites. Certains de mes clients veulent s'occuper des hébergements mais sont perdus concernant les activités, d'autres c'est plutôt le contraire. J'adapte mes forfaits en fonction de tes besoins."
  },
  {
    question: "À qui s'adressent tes services ?",
    answer: "Mes services s'adressent aux voyageurs qui souhaitent un itinéraire personnalisé en Thaïlande ou Asie du Sud-Est, sans passer des heures à organiser chaque détail. Que tu partes en couple, en famille, entre amis ou en solo, je m'adapte à ton profil, ton rythme et ton budget. En revanche, si tu recherches une agence classique qui réserve tout à ta place, mon service ne sera probablement pas adapté."
  }
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <div className="page">
      <div className="page-hero page-hero-teal">
        <h1>Questions fréquentes</h1>
        <p>Tout ce que tu dois savoir sur mes services de Travel Planner</p>
      </div>

      <section className="page-section">
        <div className="container">
          <div className="prose-wide" style={{textAlign: 'center', marginBottom: '48px'}}>
            <p className="lead">
              Tu prépares un voyage en Thaïlande ou en Asie du Sud-Est et tu te demandes comment
              fonctionne l'accompagnement d'une Travel Planner ? Voici les réponses aux questions
              qu'on me pose le plus fréquemment.
            </p>
          </div>

          <div className="faq-list">
            {FAQS.map((faq, i) => (
              <div className="faq-item" key={i}>
                <h3
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px'
                  }}
                >
                  <span>{faq.question}</span>
                  <span style={{
                    fontSize: '0.8rem',
                    transform: openIndex === i ? 'rotate(180deg)' : 'rotate(0)',
                    transition: 'transform 0.3s',
                    flexShrink: 0
                  }}>▼</span>
                </h3>
                {openIndex === i && (
                  <p style={{marginTop: '8px'}}>{faq.answer}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="page-section bg-cream" style={{textAlign: 'center'}}>
        <div className="container">
          <h2>Tu ne trouves pas la réponse à ta question ?</h2>
          <div className="prose" style={{textAlign: 'center'}}>
            <p>
              Envoie-moi un message et discutons ensemble de mon accompagnement
              ou de ton projet de voyage gratuitement.
            </p>
          </div>
          <Link to="/contact#formulaire" className="btn-primary btn-large" style={{marginTop: '24px'}}>
            Me contacter
          </Link>
          <div style={{marginTop: '60px', paddingTop: '40px', borderTop: '1px solid rgba(0,0,0,0.05)'}}>
            <h3>Reste informé(e)</h3>
            <p style={{maxWidth: '600px', margin: '0 auto 24px', color: 'var(--text-medium)'}}>
              Rejoins ma newsletter pour recevoir mes derniers conseils, astuces et recommandations locales directement
              dans ta boîte mail.
            </p>
          </div>
        <div className="ml-embedded" data-form="Ew3n64"></div>
        </div>
      </section>
    </div>
  );
}
