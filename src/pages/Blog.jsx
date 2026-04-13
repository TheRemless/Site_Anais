import { Link } from "react-router-dom";
import "../styles/pages.css";

const BLOG_POSTS = [
  {
    slug: "2-semaines-en-thailande",
    title: "2 semaines en Thaïlande — L'itinéraire parfait + conseils locaux",
    excerpt: "Bangkok, Chiang Mai, les îles... Je te donne mon itinéraire complet de 2 semaines en Thaïlande avec les transports, les hébergements et tous mes conseils de terrain pour un voyage réussi.",
    category: "Itinéraire",
    date: "15 janvier 2025"
  },
  {
    slug: "erreurs-a-eviter-thailande",
    title: "Voyage en Thaïlande : les erreurs à éviter absolument",
    excerpt: "Réserver trop tôt ses îles, mal choisir sa saison, se faire avoir par les tuk-tuks... Voici les erreurs les plus fréquentes que je vois chez les voyageurs en Thaïlande, et comment les éviter.",
    category: "Conseils",
    date: "3 mars 2025"
  },
  {
    slug: "organiser-voyage-thailande-sans-agence",
    title: "Comment organiser un voyage en Thaïlande sans agence (guide complet)",
    excerpt: "Tout faire soi-même ou se faire accompagner par un travel planner ? Ce guide complet t'explique les différences, les avantages de chaque option, et comment organiser ton voyage en Thaïlande sereinement.",
    category: "Guide",
    date: "20 mars 2025"
  }
];

export default function Blog() {
  return (
    <div className="page">
      <div className="page-hero page-hero-teal">
        <h1>Blog</h1>
        <p>Conseils, itinéraires et astuces pour ton voyage en Thaïlande</p>
      </div>

      <section className="page-section">
        <div className="container">
          <div className="trust-grid">
            {BLOG_POSTS.map((post, i) => (
              <Link to={`/blog/${post.slug}`} key={i} className="trust-card blog-card-link">
                <div className="blog-card-meta">
                  <span className="blog-cat-label">{post.category}</span>
                  <span className="blog-card-date">{post.date}</span>
                </div>
                <h3>{post.title}</h3>
                <p>{post.excerpt}</p>
                <span className="blog-read-link">Lire l'article →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
