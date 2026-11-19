import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    rolldownOptions: {
      output: {
        // Tre file separati, ognuno con la propria cache nel browser: le
        // librerie cambiano quasi mai, i dati del catalogo spesso, il codice
        // dell'app a ogni modifica. Così un aggiornamento dei dati non
        // obbliga a riscaricare React/Sigma e viceversa.
        codeSplitting: {
          groups: [
            { name: 'librerie', test: /node_modules/ },
            { name: 'dati', test: /src[\\/]data[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: ['.devtunnels.ms'],
  },
  preview: {
    host: true,
    allowedHosts: ['.devtunnels.ms'],
  },
})
