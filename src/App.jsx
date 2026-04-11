import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Pages
import Home from './pages/Home';
import Services from './pages/Services';
import APropos from './pages/APropos';
import Blog from './pages/Blog';
import BlogPost from './pages/BlogPost';
import CoursThai from './pages/CoursThai';
import Contact from './pages/Contact';
import FAQ from './pages/FAQ';

// Composants
import NavBar from './components/NavBar';
import Footer from './components/Footer';
import ScrollToTop from './components/ScrollToTop';

import './styles/globals.css';

export default function App() {
  return (
    <Router>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <ScrollToTop />
        <NavBar />
        <main style={{ flex: 1 }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/services" element={<Services />} />
            <Route path="/a-propos" element={<APropos />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:slug" element={<BlogPost />} />
            <Route path="/cours-thai" element={<CoursThai />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/faq" element={<FAQ />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </Router>
  );
}
