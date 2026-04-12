import { motion } from "framer-motion";
import { useState } from "react";
import MailerLiteForm from "../components/MailerLiteForm";
import "../styles/galerie.css";

const GALLERY_IMAGES = [
  { id: 1, title: "Coucher de soleil Thaïlande", emoji: "🌅", category: "Paysages" },
  { id: 2, title: "Temple Bali", emoji: "🏯", category: "Architecture" },
  { id: 3, title: "Plage de Lombok", emoji: "🏖️", category: "Plages" },
  { id: 4, title: "Marché local", emoji: "🛍️", category: "Culture" },
  { id: 5, title: "Randonnée jungle", emoji: "🌴", category: "Aventure" },
  { id: 6, title: "Nourriture locale", emoji: "🍜", category: "Gastronomie" },
  { id: 7, title: "Bateau traditionnel", emoji: "⛵", category: "Transport" },
  { id: 8, title: "Rituel local", emoji: "🙏", category: "Culture" },
  { id: 9, title: "Paysage montagneux", emoji: "⛰️", category: "Paysages" },
];

const CATEGORIES = ["Tous", "Paysages", "Architecture", "Plages", "Culture", "Aventure", "Gastronomie"];

export default function Galerie() {
  const [selectedCategory, setSelectedCategory] = useState("Tous");
  const [selectedImage, setSelectedImage] = useState(null);

  const filteredImages = selectedCategory === "Tous"
    ? GALLERY_IMAGES
    : GALLERY_IMAGES.filter(img => img.category === selectedCategory);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1, delayChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: { opacity: 1, scale: 1, transition: { duration: 0.5 } },
  };

  return (
    <div className="galerie-page">
      {/* Header */}
      <section className="galerie-header">
        <div className="header-background">
          <motion.div className="header-particle" animate={{ y: [0, -30, 0] }} transition={{ duration: 5, repeat: Infinity }} />
          <motion.div className="header-particle" animate={{ y: [0, 30, 0] }} transition={{ duration: 6, repeat: Infinity, delay: 1 }} />
        </div>

        <motion.div className="header-content" initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
          <h1>Galerie de voyage</h1>
          <p>Moments magiques et souvenirs de mes aventures en Asie</p>
        </motion.div>
      </section>

      {/* Filter */}
      <section className="galerie-filter">
        <div className="filter-container">
          {CATEGORIES.map((cat) => (
            <motion.button
              key={cat}
              className={`category-btn ${selectedCategory === cat ? "active" : ""}`}
              onClick={() => setSelectedCategory(cat)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {cat}
            </motion.button>
          ))}
        </div>
      </section>

      {/* Gallery Grid */}
      <section className="galerie-section">
        <motion.div
          className="gallery-grid"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          key={selectedCategory}
        >
          {filteredImages.map((image) => (
            <motion.div
              key={image.id}
              variants={itemVariants}
              className="gallery-item"
              onClick={() => setSelectedImage(image)}
              whileHover={{ scale: 1.05 }}
            >
              <div className="image-placeholder">
                <span className="image-emoji">{image.emoji}</span>
                <div className="image-overlay">
                  <h3>{image.title}</h3>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Lightbox */}
      {selectedImage && (
        <motion.div
          className="lightbox"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setSelectedImage(null)}
        >
          <motion.div
            className="lightbox-content"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="image-emoji-large">{selectedImage.emoji}</span>
            <h2>{selectedImage.title}</h2>
            <p>{selectedImage.category}</p>
            <button className="close-btn" onClick={() => setSelectedImage(null)}>✕</button>
          </motion.div>
        </motion.div>
      )}

      {/* Stats Section */}
      <section className="gallery-stats">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false }}
        >
          <div className="stat">
            <h3>50+</h3>
            <p>Voyageurs satisfaits</p>
          </div>
          <div className="stat">
            <h3>20+</h3>
            <p>Destinations explorées</p>
          </div>
          <div className="stat">
            <h3>1000+</h3>
            <p>Photos d'aventure</p>
          </div>
        </motion.div>
      </section>

      {/* CTA */}
      <section className="cta-galerie">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: false }}
        >
          <h2>Crée tes propres souvenirs</h2>
          <p>Rejoins-moi pour une aventure inoubliable</p>
          <button className="btn-primary btn-large btn-glow">Commencer mon voyage</button>
        </motion.div>
      </section>

      <section className="page-section bg-cream" style={{textAlign: 'center'}}>
        <div className="container">
          <h2>Reste connecté(e)</h2>
          <div className="prose" style={{textAlign: 'center', maxWidth: '600px', margin: '0 auto 24px'}}>
            <p>
              Abonne-toi à ma newsletter pour recevoir mes derniers conseils voyage
              et mes meilleures adresses en Asie.
            </p>
          </div>
          <MailerLiteForm />
        </div>
      </section>
    </div>
  );
}
