import { Link } from "react-router-dom";
import "../styles/footer.css";

const MailIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
  </svg>
);

const PhoneIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
);

const InstagramIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/>
  </svg>
);

const FacebookIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
  </svg>
);

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-col">
          <div className="footer-logo">
            <div className="footer-logo-circle">Z</div>
            <strong>Zwald Travel Planner</strong>
          </div>
          <p>Organisatrice de voyages sur-mesure en Thaïlande et Asie du Sud-Est</p>
        </div>

        <div className="footer-col">
          <h4>Navigation</h4>
          <Link to="/">Accueil</Link>
          <Link to="/a-propos">À propos</Link>
          <Link to="/services">Mes services</Link>
          <Link to="/blog">Blog</Link>
          <Link to="/faq">FAQ</Link>
          <Link to="/contact">Contact</Link>
        </div>

        <div className="footer-col">
          <h4>Services</h4>
          <Link to="/services">Voyages sur mesure</Link>
          <Link to="/cours-thai">Cours de thaï</Link>
          <Link to="/contact">Cartes cadeaux</Link>
          <Link to="/contact">Mini-guides PDF</Link>
        </div>

        <div className="footer-col">
          <h4>Contact</h4>
          <a href="mailto:zwaldtravelplanner@gmail.com" className="footer-contact-link">
            <MailIcon />
            <span>zwaldtravelplanner@gmail.com</span>
          </a>
          <a href="https://wa.me/66958683846" className="footer-contact-link">
            <PhoneIcon />
            <span>WhatsApp: +66 95 868 38 46</span>
          </a>
          <div className="footer-social">
            <a href="https://www.instagram.com/zwaldtravelplanner/" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
              <InstagramIcon />
            </a>
            <a href="https://www.facebook.com/people/Zwald-Travel-Planner/61568573411432/" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
              <FacebookIcon />
            </a>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <p>&copy; {new Date().getFullYear()} Zwald Travel Planner — Anaïs Zwald</p>
      </div>
    </footer>
  );
}
