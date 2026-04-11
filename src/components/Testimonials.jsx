import { useState, useEffect } from "react";
import { TESTIMONIALS } from "../data";
import "../styles/testimonials.css";

export default function Testimonials() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setActive((a) => (a + 1) % TESTIMONIALS.length), 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section id="temoignages" className="testimonials">
      <div className="testimonials-container">
        <div className="section-header">
          <span className="section-tag">Témoignages</span>
          <h2>Ce que disent mes voyageurs</h2>
          <div className="stars">
            {[1,2,3,4,5].map(s => <span key={s}>★</span>)}
          </div>
          <p>Note moyenne 5/5 sur Google</p>
        </div>

        <div className="testimonial-card">
          <div className="quote-mark">"</div>
          <p className="testimonial-text">
            {TESTIMONIALS[active].text}
          </p>
          <div className="testimonial-author">
            <p className="author-name">{TESTIMONIALS[active].name}</p>
            <p className="author-info">{TESTIMONIALS[active].trip} - {TESTIMONIALS[active].type}</p>
          </div>
        </div>

        <div className="testimonial-dots">
          {TESTIMONIALS.map((_, i) => (
            <div
              key={i}
              className={`dot ${active === i ? "active" : ""}`}
              onClick={() => setActive(i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
