/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        copa: {
          green: '#22C55E',   // verde esportivo principal
          gold:  '#4ADE80',   // verde claro — pontos / destaques
          red:   '#EF4444',   // vermelho admin
          dark:  '#070707',   // fundo preto
          navy:  '#111111',   // cards
        },
      },
      fontFamily: {
        display: ['system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
