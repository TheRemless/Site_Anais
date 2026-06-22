import { useState } from "react";
import "../styles/contact.css";

export default function Contact() {
  const [sent, setSent] = useState(false);

  return (
    <section id="contact" className="contact">
      <div className="contact-container">
        <div className="section-header">
          <span className="section-tag">Contact</span>
          <h2>Prêt(e) à organiser ton voyage ?</h2>
          <p>
            Réserve ton appel découverte gratuit et sans engagement. On discute de ton projet et je te dis comment je peux t'aider.
          </p>
        </div>

        <div className="contact-content">
          <div className="contact-info">
            <h3>Mes coordonnées</h3>

            <div className="contact-item">
              <div className="contact-icon">📧</div>
              <div>
                <p className="label">Email</p>
                <p className="value">zwaldtravelplanner@gmail.com</p>
              </div>
            </div>

            <div className="contact-item">
              <div className="contact-icon">📱</div>
              <div>
                <p className="label">WhatsApp</p>
                <p className="value">+66 95 868 38 46</p>
              </div>
            </div>

            <div className="contact-item">
              <div className="contact-icon">📅</div>
              <div>
                <p className="label">Appel découverte</p>
                <p className="value">Réserver un créneau gratuit</p>
              </div>
            </div>

            <div className="social-links">
              <div className="social-badge">Instagram</div>
              <div className="social-badge">Facebook</div>
            </div>
          </div>

          <div className="contact-form">
            <h3>Envoie-moi un message</h3>
            <p>Je reviens vers toi sous 48h</p>

            {!sent ? (
              <form onSubmit={(e) => { e.preventDefault(); setSent(true); }}>
                <input type="text" placeholder="Ton nom" required />
                <input type="email" placeholder="Ton email" required />
                <textarea placeholder="Parle-moi de ton projet de voyage..." rows="4" required></textarea>
                <button type="submit" className="btn-primary">Envoyer mon message</button>
              </form>
            ) : (
              <div className="form-success">
                <div className="success-emoji">✅</div>
                <p className="success-text">Message envoyé !</p>
                <p className="success-subtext">Je reviens vers toi très vite.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
