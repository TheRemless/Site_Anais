import { motion } from "framer-motion";
import { useState } from "react";
import MailerLiteForm from "../components/MailerLiteForm";
import "../styles/destinations.css";

const DESTINATIONS = [
  {
    id: 1,
    name: "Thaïlande",
    emoji: "🇹🇭",
    color: "#e85d6b",
    description: "Temples dorés, marchés flottants et plages paradisiaques",
    highlights: ["Bangkok", "Chiang Mai", "Îles Phi Phi", "Ayutthaya"],
    bestTime: "Nov - Feb"
  },
  {
    id: 2,
    name: "Bali",
    emoji: "🏝️",
    color: "#4a90e2",
    description: "Rizières en terrasses, temples mystiques et couchers de soleil magiques",
    highlights: ["Ubud", "Seminyak", "Mont Batur", "Tanah Lot"],
    bestTime: "Avr - Oct"
  },
  {
    id: 3,
    name: "Lombok",
    emoji: "🌴",
    color: "#50c878",
    description: "Plages secrètes et nature sauvage loin de la foule",
    highlights: ["Gili Islands", "Kuta Beach", "Mont Rinjani", "Senggigi"],
    bestTime: "Mar - Déc"
  },
  {
    id: 4,
    name: "Indonésie",
    emoji: "🌏",
    color: "#ffa500",
    description: "Archipel magique avec mille îles à découvrir",
    highlights: ["Java", "Sumatra", "Flores", "Sulawesi"],
    bestTime: "Avr - Oct"
  }
];

export default function Destinations() {
  const [selectedDest, setSelectedDest] = useState(null);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.15, delayChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6 } },
  };

  return (
    <div className="destinations-page">
      {/* Header */}
      <section className="destinations-header">
        <div className="header-background">
          <motion.div className="header-blob-1" animate={{ x: [0, 30, 0], y: [0, -30, 0] }} transition={{ duration: 8, repeat: Infinity }} />
          <motion.div className="header-blob-2" animate={{ x: [0, -40, 0], y: [0, 30, 0] }} transition={{ duration: 10, repeat: Infinity }} />
        </div>

        <motion.div className="header-content" initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
          <h1>Destinations</h1>
          <p>Explore les plus beaux endroits d'Asie du Sud-Est avec moi</p>
        </motion.div>
      </section>

      {/* Destinations Grid */}
      <section className="destinations-section">
        <motion.div
          className="destinations-grid"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: false }}
        >
          {DESTINATIONS.map((dest) => (
            <motion.div
              key={dest.id}
              variants={itemVariants}
              className="destination-card-large"
              style={{ borderColor: dest.color }}
              whileHover={{ y: -15 }}
              onClick={() => setSelectedDest(selectedDest === dest.id ? null : dest.id)}
            >
              <div className="dest-header" style={{ backgroundColor: `${dest.color}15` }}>
                <span className="dest-emoji-large">{dest.emoji}</span>
              </div>

              <h2>{dest.name}</h2>
              <p className="dest-description">{dest.description}</p>

              <motion.div
                className="dest-expanded"
                initial={{ opacity: 0, height: 0 }}
                animate={{
                  opacity: selectedDest === dest.id ? 1 : 0,
                  height: selectedDest === dest.id ? "auto" : 0
                }}
              >
                <div className="highlights-section">
                  <h4>Points clés :</h4>
                  <div className="highlights-list">
                    {dest.highlights.map((h, i) => (
                      <span key={i} className="highlight-badge" style={{ borderColor: dest.color, color: dest.color }}>
                        {h}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="best-time">
                  <span className="time-label">Meilleure période :</span>
                  <span className="time-value">{dest.bestTime}</span>
                </div>
              </motion.div>

              <motion.button
                className="discover-btn"
                style={{ borderColor: dest.color, color: dest.color }}
                whileHover={{ backgroundColor: dest.color, color: "#fff" }}
              >
                Découvrir plus
              </motion.button>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Map section */}
      <section className="map-section">
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: false }}>
          <h2>Voir la carte interactive</h2>
          <div className="map-placeholder">
            <p>🗺️ Carte interactive des destinations à venir</p>
          </div>
        </motion.div>
      </section>

      {/* CTA Section */}
      <section className="cta-destinations">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: false }}>
          <h2>Besoin d'aide pour choisir ?</h2>
          <p>Je vais t'aider à trouver la destination parfaite selon tes envies</p>
          <button className="btn-primary btn-large btn-glow">Réserver une consultation</button>
        </motion.div>
      </section>

      <section className="page-section" style={{textAlign: 'center', background: 'var(--bg-sand)'}}>
        <div className="container">
          <h2>Reste informé(e)</h2>
          <div className="prose" style={{textAlign: 'center', maxWidth: '600px', margin: '0 auto 24px'}}>
            <p>
              Rejoins ma newsletter pour recevoir mes derniers conseils, astuces et
              recommandations locales directement dans ta boîte mail.
            </p>
          </div>
          <MailerLiteForm />
        </div>
      </section>
    </div>
  );
}
