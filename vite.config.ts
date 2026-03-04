import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Para GitHub Pages use base: '/nome-do-repo/'
// O workflow define VITE_BASE_PATH; em Vercel/local fica '/'
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH ?? "/",
});
