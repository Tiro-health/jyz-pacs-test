import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        launch: "launch.html",
        callback: "callback.html",
        flow: "flow.html",
        qc: "qc.html",
        cases: "cases.html",
        db: "db.html",
      },
    },
  },
});
