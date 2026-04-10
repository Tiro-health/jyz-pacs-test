import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        launch: "launch.html",
        callback: "callback.html",
      },
    },
  },
});
