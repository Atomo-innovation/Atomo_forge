// vite.config.ts
import { defineConfig } from "file:///home/rajat/Downloads/MeshCentral-master/atomo-forge-suite/node_modules/vite/dist/node/index.js";
import react from "file:///home/rajat/Downloads/MeshCentral-master/atomo-forge-suite/node_modules/@vitejs/plugin-react-swc/index.js";
import path from "path";
import fs from "fs";
import { componentTagger } from "file:///home/rajat/Downloads/MeshCentral-master/atomo-forge-suite/node_modules/lovable-tagger/dist/index.js";
var __vite_injected_original_dirname = "/home/rajat/Downloads/MeshCentral-master/atomo-forge-suite";
var vite_config_default = defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8444,
    strictPort: true,
    https: {
      key: fs.readFileSync(path.resolve(__vite_injected_original_dirname, "./devcert/key.pem")),
      cert: fs.readFileSync(path.resolve(__vite_injected_original_dirname, "./devcert/cert.pem"))
    },
    hmr: {
      overlay: false
    },
    proxy: {
      "/api": { target: "http://localhost:3002", changeOrigin: true }
    }
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9yYWphdC9Eb3dubG9hZHMvTWVzaENlbnRyYWwtbWFzdGVyL2F0b21vLWZvcmdlLXN1aXRlXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9yYWphdC9Eb3dubG9hZHMvTWVzaENlbnRyYWwtbWFzdGVyL2F0b21vLWZvcmdlLXN1aXRlL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3JhamF0L0Rvd25sb2Fkcy9NZXNoQ2VudHJhbC1tYXN0ZXIvYXRvbW8tZm9yZ2Utc3VpdGUvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdC1zd2NcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgZnMgZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBjb21wb25lbnRUYWdnZXIgfSBmcm9tIFwibG92YWJsZS10YWdnZXJcIjtcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBtb2RlIH0pID0+ICh7XG4gIHNlcnZlcjoge1xuICAgIGhvc3Q6IFwiOjpcIixcbiAgICBwb3J0OiA4NDQ0LFxuICAgIHN0cmljdFBvcnQ6IHRydWUsXG4gICAgaHR0cHM6IHtcbiAgICAgIGtleTogZnMucmVhZEZpbGVTeW5jKHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9kZXZjZXJ0L2tleS5wZW1cIikpLFxuICAgICAgY2VydDogZnMucmVhZEZpbGVTeW5jKHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9kZXZjZXJ0L2NlcnQucGVtXCIpKSxcbiAgICB9LFxuICAgIGhtcjoge1xuICAgICAgb3ZlcmxheTogZmFsc2UsXG4gICAgfSxcbiAgICBwcm94eToge1xuICAgICAgXCIvYXBpXCI6IHsgdGFyZ2V0OiBcImh0dHA6Ly9sb2NhbGhvc3Q6MzAwMlwiLCBjaGFuZ2VPcmlnaW46IHRydWUgfSxcbiAgICB9LFxuICB9LFxuICBwbHVnaW5zOiBbcmVhY3QoKSwgbW9kZSA9PT0gXCJkZXZlbG9wbWVudFwiICYmIGNvbXBvbmVudFRhZ2dlcigpXS5maWx0ZXIoQm9vbGVhbiksXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmNcIiksXG4gICAgfSxcbiAgfSxcbn0pKTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBZ1csU0FBUyxvQkFBb0I7QUFDN1gsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sVUFBVTtBQUNqQixPQUFPLFFBQVE7QUFDZixTQUFTLHVCQUF1QjtBQUpoQyxJQUFNLG1DQUFtQztBQU96QyxJQUFPLHNCQUFRLGFBQWEsQ0FBQyxFQUFFLEtBQUssT0FBTztBQUFBLEVBQ3pDLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLFlBQVk7QUFBQSxJQUNaLE9BQU87QUFBQSxNQUNMLEtBQUssR0FBRyxhQUFhLEtBQUssUUFBUSxrQ0FBVyxtQkFBbUIsQ0FBQztBQUFBLE1BQ2pFLE1BQU0sR0FBRyxhQUFhLEtBQUssUUFBUSxrQ0FBVyxvQkFBb0IsQ0FBQztBQUFBLElBQ3JFO0FBQUEsSUFDQSxLQUFLO0FBQUEsTUFDSCxTQUFTO0FBQUEsSUFDWDtBQUFBLElBQ0EsT0FBTztBQUFBLE1BQ0wsUUFBUSxFQUFFLFFBQVEseUJBQXlCLGNBQWMsS0FBSztBQUFBLElBQ2hFO0FBQUEsRUFDRjtBQUFBLEVBQ0EsU0FBUyxDQUFDLE1BQU0sR0FBRyxTQUFTLGlCQUFpQixnQkFBZ0IsQ0FBQyxFQUFFLE9BQU8sT0FBTztBQUFBLEVBQzlFLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLGtDQUFXLE9BQU87QUFBQSxJQUN0QztBQUFBLEVBQ0Y7QUFDRixFQUFFOyIsCiAgIm5hbWVzIjogW10KfQo=
