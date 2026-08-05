import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  assetsInclude: ["**/*.glb"], // 💡 3D 파일(.glb)을 읽게 해주는 핵심 코드!
});
