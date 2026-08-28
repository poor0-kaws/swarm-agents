import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = Number(process.env.API_PORT ?? 4100);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.CONDUCTOR_PORT ?? 5173),
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
});
