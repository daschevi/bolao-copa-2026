/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        copa: {
          green: '#006847',
          gold: '#C9A84C',
          red: '#C8102E',
          dark: '#0a1628',
          navy: '#1a2744',
        },
      },
    },
  },
  plugins: [],
}

