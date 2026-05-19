/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      colors: {
        ink: '#071016',
        panel: '#0d1a21',
        line: '#1d3942',
        sea: '#26d6c5',
        cyanSoft: '#8ee8ff'
      }
    }
  },
  plugins: []
}

