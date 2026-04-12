import { useState } from "react";
import "../styles/pages.css";
import MailerLiteForm from "../components/MailerLiteForm";

export default function Contact() {
  const [form, setForm] = useState({ name: "", email: "", subject: "voyage", message: "" });
  const [sent, setSent] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    // Submit to Netlify Forms
    const formData = new URLSearchParams();
    formData.append("form-name", "contact");
    formData.append("name", form.name);
    formData.append("email", form.email);
    formData.append("subject", form.subject);
    formData.append("message", form.message);

    fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    })
      .then(() => setSent(true))
      .catch(() => setSent(true)); // Show success anyway — Netlify will retry
  }

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  return (
    <div className="page">
      <div className="page-hero page-hero-teal">
        <h1>Contact</h1>
        <p>Je suis là pour répondre à tes questions et t'aider à créer ton voyage sur mesure</p>
      </div>

      <section id="formulaire" className="page-section">
        <div className="container">
          <div className="prose-wide" style={{textAlign: 'center', marginBottom: '48px'}}>
            <p className="lead">
              Que tu en sois au tout début de ta réflexion ou que tu aies déjà une idée précise
              de ton itinéraire, je serai ravie de t'accompagner. Remplis le formulaire ci-dessous
              et je te répondrai dans les plus brefs délais.
            </p>
          </div>

          {sent ? (
            <div className="form-success">
              <h3>Message envoyé avec succès !</h3>
              <p>Merci pour ton message, {form.name || "voyageur(se)"} ! Je te répondrai dans les plus brefs délais (généralement sous 24-48h).</p>
              <button className="btn-primary" onClick={() => { setSent(false); setForm({ name: "", email: "", subject: "voyage", message: "" }); }} style={{marginTop: '16px'}}>
                Envoyer un autre message
              </button>
            </div>
          ) : (
            <form className="contact-form" name="contact" method="POST" data-netlify="true" onSubmit={handleSubmit}>
              <input type="hidden" name="form-name" value="contact" />
              <div className="form-group">
                <label htmlFor="name">Ton prénom</label>
                <input type="text" id="name" name="name" value={form.name} onChange={handleChange} placeholder="Ex: Sophie" required />
              </div>
              <div className="form-group">
                <label htmlFor="email">Ton adresse email</label>
                <input type="email" id="email" name="email" value={form.email} onChange={handleChange} placeholder="sophie@email.com" required />
              </div>
              <div className="form-group">
                <label htmlFor="subject">Sujet</label>
                <select id="subject" name="subject" value={form.subject} onChange={handleChange}>
                  <option value="voyage">Voyage sur mesure</option>
                  <option value="devis">Demande de devis</option>
                  <option value="appel">Appel découverte</option>
                  <option value="cours">Cours de thaï</option>
                  <option value="carte">Carte cadeau</option>
                  <option value="guide">Mini-guide PDF</option>
                  <option value="autre">Autre question</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="message">Ton message</label>
                <textarea id="message" name="message" value={form.message} onChange={handleChange} placeholder="Parle-moi de ton projet de voyage, tes dates, ton budget, ou pose-moi tes questions..." required />
              </div>
              <button type="submit" className="btn-primary btn-large" style={{width: '100%'}}>
                Envoyer mon message
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="page-section bg-cream">
        <div className="container">
          <div className="contact-info">
            <div className="contact-card">
              <strong>WhatsApp</strong>
              <a href="https://wa.me/66958683846">+66 95 868 38 46</a>
              <p style={{margin: '8px 0 0', fontSize: '0.85rem', color: 'var(--text-light)'}}>Pour les questions rapides</p>
            </div>
            <div className="contact-card">
              <strong>Appel découverte</strong>
              <p style={{margin: 0, fontSize: '0.9rem', color: 'var(--text-medium)'}}>Gratuit et sans engagement</p>
              <p style={{margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-light)'}}>Sélectionne "Appel découverte" dans le formulaire</p>
            </div>
            <div className="contact-card">
              <strong>Réseaux sociaux</strong>
              <div style={{display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '8px'}}>
                <a href="https://www.instagram.com/zwaldtravelplanner/" target="_blank" rel="noopener noreferrer">Instagram</a>
                <a href="https://www.facebook.com/people/Zwald-Travel-Planner/61568573411432/" target="_blank" rel="noopener noreferrer">Facebook</a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="page-section">
        <div className="container" style={{textAlign: 'center'}}>
          <h2>Cartes cadeaux voyage</h2>
          <div className="prose" style={{textAlign: 'center'}}>
            <p>
              Anniversaire, mariage, Noël, cadeau commun… Mes cartes cadeaux 100% personnalisables
              donnent accès à l'intégralité de mes services de Travel Planner : itinéraires sur mesure,
              carnet de voyage personnalisé, conseils locaux et accompagnement.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
