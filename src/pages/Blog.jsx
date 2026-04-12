import { Link } from "react-router-dom";
import "../styles/pages.css";

const BLOG_POSTS = [
  {
    slug: "2-semaines-en-thailande",
    title: "2 semaines en Thaïlande — L'itinéraire parfait + conseils locaux",
    excerpt: "Un itinéraire complet de 2 semaines pour découvrir la Thaïlande avec mes conseils de terrain.",
    category: "Itinéraire"
  },
  {
    slug: "erreurs-a-eviter-thailande",
    title: "Voyage en Thaïlande : les erreurs à éviter absolument",
    excerpt: "Les erreurs les plus fréquentes lors de l'organisation d'un voyage en Thaïlande et comment les éviter.",
    category: "Conseils"
  },
  {
    slug: "organiser-voyage-thailande-sans-agence",
    title: "Comment organiser un voyage en Thaïlande sans agence (guide complet)",
    excerpt: "Un guide complet pour comprendre les différences entre organiser son voyage seul ou se faire accompagner.",
    category: "Guide"
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
                <span className="blog-cat-label">{post.category}</span>
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
