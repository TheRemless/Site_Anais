import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { TextPlugin } from 'gsap/TextPlugin';

gsap.registerPlugin(ScrollTrigger, TextPlugin);

/**
 * Animation pour les éléments au scroll (Fade in + slide)
 */
export const animateFadeInUp = (selector, options = {}) => {
  const defaults = {
    duration: 0.8,
    delay: 0,
    y: 30,
    opacity: 0,
    stagger: 0.1,
  };

  const config = { ...defaults, ...options };

  gsap.to(selector, {
    scrollTrigger: {
      trigger: selector,
      start: 'top 80%',
      markers: false,
    },
    duration: config.duration,
    delay: config.delay,
    y: 0,
    opacity: 1,
    stagger: config.stagger,
    ease: 'power3.out',
  });
};

/**
 * Animation parallax smooth
 */
export const animateParallax = (elementSelector, intensity = 0.5) => {
  gsap.to(elementSelector, {
    scrollTrigger: {
      trigger: elementSelector,
      start: 'top center',
      scrub: 1.2, // Smooth scrub effect
      markers: false,
    },
    y: (index) => -window.innerHeight * intensity,
    ease: 'none',
  });
};

/**
 * Animation de révélation de texte
 */
export const animateTextReveal = (selector, options = {}) => {
  const defaults = {
    duration: 1.2,
    stagger: 0.02,
    delay: 0,
  };

  const config = { ...defaults, ...options };

  const elements = document.querySelectorAll(selector);

  elements.forEach((el) => {
    const text = el.innerText;
    el.innerHTML = text
      .split('')
      .map((char) => `<span class="char">${char}</span>`)
      .join('');

    gsap.from('.char', {
      scrollTrigger: {
        trigger: el,
        start: 'top 80%',
      },
      duration: config.duration,
      delay: config.delay,
      opacity: 0,
      y: 20,
      stagger: config.stagger,
      ease: 'back.out',
    });
  });
};

/**
 * Animation hover magnétique
 */
export const createMagneticButton = (selector) => {
  const buttons = document.querySelectorAll(selector);

  buttons.forEach((button) => {
    let mouseX = 0;
    let mouseY = 0;
    let elementX = 0;
    let elementY = 0;

    button.addEventListener('mousemove', (e) => {
      const rect = button.getBoundingClientRect();
      mouseX = e.clientX - rect.left - rect.width / 2;
      mouseY = e.clientY - rect.top - rect.height / 2;

      gsap.to(button, {
        x: mouseX * 0.2,
        y: mouseY * 0.2,
        duration: 0.6,
        ease: 'power2.out',
      });
    });

    button.addEventListener('mouseleave', () => {
      gsap.to(button, {
        x: 0,
        y: 0,
        duration: 0.6,
        ease: 'power2.out',
      });
    });
  });
};

/**
 * Animation de gradient animé
 */
export const animateGradientBg = (selector) => {
  const element = document.querySelector(selector);
  if (!element) return;

  gsap.fromTo(
    element,
    {
      backgroundPosition: '0% 50%',
    },
    {
      backgroundPosition: '100% 50%',
      duration: 8,
      repeat: -1,
      yoyo: true,
      ease: 'none',
    }
  );
};

/**
 * Animation de compteur de nombres
 */
export const animateCounter = (selector, endValue, duration = 2) => {
  const element = document.querySelector(selector);
  if (!element) return;

  gsap.to(element, {
    innerHTML: endValue,
    duration: duration,
    snap: { innerHTML: 1 },
    ease: 'power1.inOut',
  });
};

/**
 * Animation des cartes au hover
 */
export const createCardHoverEffect = (selector) => {
  const cards = document.querySelectorAll(selector);

  cards.forEach((card) => {
    card.addEventListener('mouseenter', () => {
      gsap.to(card, {
        y: -15,
        duration: 0.4,
        ease: 'power2.out',
        boxShadow: '0 20px 50px rgba(99, 102, 241, 0.3)',
      });
    });

    card.addEventListener('mouseleave', () => {
      gsap.to(card, {
        y: 0,
        duration: 0.4,
        ease: 'power2.out',
        boxShadow: '0 4px 15px rgba(0, 0, 0, 0.1)',
      });
    });
  });
};

/**
 * Animation scroll timeline
 */
export const createScrollTimeline = (selector) => {
  const element = document.querySelector(selector);
  if (!element) return;

  gsap.set(element, { opacity: 0 });

  gsap.to(element, {
    scrollTrigger: {
      trigger: element,
      start: 'top center',
      end: 'bottom center',
      scrub: true,
      markers: false,
    },
    opacity: 1,
    duration: 1,
  });
};

/**
 * Stagger animation pour listes
 */
export const staggerAnimation = (selector, options = {}) => {
  const defaults = {
    duration: 0.6,
    stagger: 0.15,
    from: { opacity: 0, y: 30 },
    to: { opacity: 1, y: 0 },
  };

  const config = { ...defaults, ...options };

  gsap.fromTo(
    selector,
    config.from,
    {
      ...config.to,
      duration: config.duration,
      stagger: config.stagger,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: selector,
        start: 'top 80%',
      },
    }
  );
};

/**
 * Animation des titres avec split
 */
export const animateSplitTitle = (selector) => {
  const elements = document.querySelectorAll(selector);

  elements.forEach((el) => {
    const text = el.innerText;
    const lines = text.split('\n');

    el.innerHTML = lines
      .map(
        (line) =>
          `<span class="line overflow-hidden inline-block">
        <span class="inline-block">${line}</span>
      </span>`
      )
      .join('<br/>');

    gsap.fromTo(
      '.line span',
      {
        opacity: 0,
        y: 40,
        rotationX: -90,
      },
      {
        scrollTrigger: {
          trigger: el,
          start: 'top 80%',
        },
        opacity: 1,
        y: 0,
        rotationX: 0,
        duration: 1,
        stagger: 0.1,
        ease: 'back.out',
      }
    );
  });
};

/**
 * Blur in animation
 */
export const blurInAnimation = (selector) => {
  gsap.fromTo(
    selector,
    {
      opacity: 0,
      filter: 'blur(10px)',
    },
    {
      scrollTrigger: {
        trigger: selector,
        start: 'top 85%',
      },
      opacity: 1,
      filter: 'blur(0)',
      duration: 1,
      ease: 'power2.inOut',
    }
  );
};

/**
 * Rotate animation pour éléments
 */
export const rotateAnimation = (selector, duration = 20) => {
  gsap.to(selector, {
    rotation: 360,
    duration: duration,
    repeat: -1,
    ease: 'none',
  });
};

export default {
  animateFadeInUp,
  animateParallax,
  animateTextReveal,
  createMagneticButton,
  animateGradientBg,
  animateCounter,
  createCardHoverEffect,
  createScrollTimeline,
  staggerAnimation,
  animateSplitTitle,
  blurInAnimation,
  rotateAnimation,
};
