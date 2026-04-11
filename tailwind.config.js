/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#6366F1',
        'primary-dark': '#4F46E5',
        'primary-light': '#818CF8',
        secondary: '#EC4899',
        'secondary-dark': '#DB2777',
        'secondary-light': '#F472B6',
        accent: '#06B6D4',
        'accent-dark': '#0891B2',
        'accent-light': '#22D3EE',
        dark: '#0F172A',
        'dark-card': '#1E293B',
        light: '#F8FAFC',
        'light-hover': '#F1F5F9',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        glow: 'glow 2s ease-in-out infinite',
        'pulse-border': 'pulse-border 2s ease-in-out infinite',
        shimmer: 'shimmer 3s infinite',
        'fade-in-up': 'fade-in-up 0.8s ease-out',
        'fade-in-down': 'fade-in-down 0.8s ease-out',
        'blur-in': 'blur-in 0.8s ease-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        glow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(99, 102, 241, 0.4)' },
          '50%': { boxShadow: '0 0 40px rgba(99, 102, 241, 0.6)' },
        },
        'pulse-border': {
          '0%, 100%': { borderColor: 'rgba(99, 102, 241, 0.5)' },
          '50%': { borderColor: 'rgba(99, 102, 241, 0.8)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
        'fade-in-up': {
          from: {
            opacity: '0',
            transform: 'translateY(30px)',
          },
          to: {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
        'fade-in-down': {
          from: {
            opacity: '0',
            transform: 'translateY(-30px)',
          },
          to: {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
        'blur-in': {
          from: {
            opacity: '0',
            filter: 'blur(10px)',
          },
          to: {
            opacity: '1',
            filter: 'blur(0)',
          },
        },
      },
    },
  },
  plugins: [],
}
