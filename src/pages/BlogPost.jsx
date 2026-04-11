import { useParams, Link } from "react-router-dom";
import "../styles/pages.css";

const BLOG_CONTENT = {
  "2-semaines-en-thailande": {
    title: "2 semaines en Thaïlande — L'itinéraire parfait + conseils locaux",
    category: "Itinéraire",
    content: `
      <p>La Thaïlande est l'une des destinations les plus prisées d'Asie du Sud-Est, et pour cause : entre plages paradisiaques, temples époustouflants, cuisine incroyable et culture riche, ce pays a tout pour plaire.</p>
      <p>Dans cet article, je te partage un itinéraire complet de 2 semaines, pensé pour découvrir les incontournables tout en prenant le temps de profiter. Cet itinéraire est basé sur mon expérience de vie sur place et sur les retours de mes voyageurs.</p>
      <h2>Semaine 1 : Le Nord</h2>
      <p>Commence par Bangkok (2-3 jours) pour t'immerger dans la culture thaïlandaise : temples, marchés, street food. Puis direction Chiang Mai (3-4 jours) pour les temples du vieux quartier, les marchés de nuit et les expériences dans la nature.</p>
      <h2>Semaine 2 : Le Sud</h2>
      <p>Cap vers les îles du sud : Koh Lanta pour son ambiance décontractée, ou Koh Samui pour plus d'activités. Termine par Krabi ou Phuket selon tes envies de plages, kayak et snorkeling.</p>
      <h2>Mes conseils locaux</h2>
      <p>Réserve tes vols internes à l'avance, privilégie les hébergements locaux, et surtout : prends le temps de discuter avec les habitants. C'est là que se trouvent les meilleures adresses et les expériences les plus authentiques.</p>
    `
  },
  "erreurs-a-eviter-thailande": {
    title: "Voyage en Thaïlande : les erreurs à éviter absolument",
    category: "Conseils",
    content: `
      <p>Organiser un voyage en Thaïlande peut sembler simple, mais certaines erreurs reviennent très fréquemment chez les voyageurs. En tant que Travel Planner basée sur place, je les vois régulièrement. Voici comment les éviter.</p>
      <h2>Erreur #1 : Sous-estimer les distances</h2>
      <p>La Thaïlande est plus grande qu'on ne le pense. Passer d'une île à une autre peut prendre une journée entière. Planifie des étapes réalistes pour ne pas passer ton voyage dans les transports.</p>
      <h2>Erreur #2 : Voyager en haute saison sans réserver</h2>
      <p>Pendant les vacances scolaires, les hébergements populaires affichent complet des mois à l'avance. Réserve 6 mois avant pour avoir le choix et les meilleurs prix.</p>
      <h2>Erreur #3 : Se fier uniquement aux réseaux sociaux</h2>
      <p>Les endroits « instagrammables » sont souvent surpeuplés et décevants en réalité. Les meilleures expériences se trouvent hors des sentiers battus, grâce aux recommandations de locaux.</p>
      <h2>Erreur #4 : Négliger l'assurance voyage</h2>
      <p>Les frais médicaux en Thaïlande peuvent être très élevés. Une bonne assurance voyage est indispensable, surtout si tu prévois des activités comme le scooter ou la plongée.</p>
    `
  },
  "organiser-voyage-thailande-sans-agence": {
    title: "Comment organiser un voyage en Thaïlande sans agence (guide complet)",
    category: "Guide",
    content: `
      <p>Beaucoup de voyageurs hésitent entre organiser leur voyage seuls ou se faire accompagner. Dans ce guide, je t'explique les avantages et les limites de chaque approche, pour que tu puisses faire le meilleur choix selon ta situation.</p>
      <h2>Organiser seul : les avantages</h2>
      <p>Tu as un contrôle total sur ton itinéraire et ton budget. Tu apprends beaucoup sur la destination en faisant tes propres recherches. Et tu as la satisfaction de tout organiser toi-même.</p>
      <h2>Organiser seul : les limites</h2>
      <p>Les recherches prennent des heures (voire des semaines). Il est difficile de savoir quelles sources sont fiables. Et tu risques de passer à côté d'expériences locales que seuls les habitants connaissent.</p>
      <h2>L'accompagnement d'un Travel Planner</h2>
      <p>Un Travel Planner ne remplace pas une agence : il ne réserve pas à ta place et ne prend aucune commission. Il t'aide à construire un itinéraire sur mesure, te fait gagner du temps et te donne accès à une expertise terrain que tu ne trouveras pas dans les guides.</p>
      <h2>Pour qui est-ce adapté ?</h2>
      <p>Si tu manques de temps, si c'est ton premier voyage en Asie, ou si tu veux simplement voyager l'esprit tranquille avec un plan solide, l'accompagnement d'un Travel Planner est un excellent investissement.</p>
    `
  }
};

export default function BlogPost() {
  const { slug } = useParams();
  const post = BLOG_CONTENT[slug];

  if (!post) {
    return (
      <div className="page">
        <div className="page-hero page-hero-teal">
          <h1>Article non trouvé</h1>
          <p>Cet article n'existe pas ou a été déplacé.</p>
        </div>
        <section className="page-section" style={{textAlign: 'center'}}>
          <Link to="/blog" className="btn-primary">Retour au blog</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-hero page-hero-teal">
        <span style={{
          display: 'inline-block',
          padding: '4px 14px',
          background: 'rgba(255,255,255,0.15)',
          borderRadius: '50px',
          fontSize: '0.8rem',
          fontWeight: '600',
          color: 'rgba(255,255,255,0.9)',
          marginBottom: '16px'
        }}>{post.category}</span>
        <h1>{post.title}</h1>
        <p>Par Anaïs Zwald — Travel Planner en Thaïlande</p>
      </div>

      <section className="page-section">
        <div className="container">
          <div className="prose-wide blog-article" dangerouslySetInnerHTML={{ __html: post.content }} />
        </div>
      </section>

      <section className="page-section bg-cream" style={{textAlign: 'center'}}>
        <div className="container">
          <h2>Envie d'organiser ton voyage ?</h2>
          <div className="prose" style={{textAlign: 'center'}}>
            <p>Je t'accompagne dans la création de ton itinéraire sur mesure en Thaïlande.</p>
          </div>
          <div style={{display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '24px'}}>
            <Link to="/contact" className="btn-primary">Me contacter</Link>
            <Link to="/blog" className="btn-secondary">Voir tous les articles</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
