import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import "../styles/navbar.css";

export default function NavBar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const links = [
    { path: "/", label: "Accueil" },
    { path: "/a-propos", label: "À propos" },
    { path: "/services", label: "Mes services" },
    { path: "/cours-thai", label: "Cours de thaï" },
    { path: "/blog", label: "Blog" },
    { path: "/faq", label: "FAQ" },
  ];

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo">
          <img src="/images/cropped-logo-2025.png" alt="Zwald Travel Planner" className="logo-img" />
        </Link>

        <div className="navbar-desktop">
          {links.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`nav-link ${location.pathname === link.path ? "active" : ""}`}
            >
              {link.label}
            </Link>
          ))}
          <Link to="/contact" className="btn-primary">
            Me contacter
          </Link>
        </div>

        <button
          className="mobile-menu-btn"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menu"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>

      {mobileOpen && (
        <motion.div
          className="mobile-menu"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {links.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`mobile-link ${location.pathname === link.path ? "active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <Link to="/contact" className="btn-primary" onClick={() => setMobileOpen(false)}
            style={{ marginTop: "8px", textAlign: "center" }}>
            Me contacter
          </Link>
        </motion.div>
      )}
    </nav>
  );
}
