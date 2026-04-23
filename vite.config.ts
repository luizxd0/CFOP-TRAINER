import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Project Pages: https://<user>.github.io/<repo>/
// Set in CI: GHP_BASE=/<repo>/  (or "/" for a <user>.github.io user site repository)
const base =
  process.env.GHP_BASE && process.env.GHP_BASE.length > 0
    ? process.env.GHP_BASE
    : "/";

export default defineConfig({
  base,
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
