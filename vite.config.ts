import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/CFOP-TRAINER/" : "/",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    allowedHosts: ["classic-gunbound.servegame.com"],
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: ["classic-gunbound.servegame.com"],
  },
});
