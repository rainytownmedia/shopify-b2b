import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type Plugin, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/** Must match storefront app proxy URL prefix (see shopify.app.toml / Partner Dashboard). */
const SHOPIFY_APP_PROXY_PATH_PREFIX = (
   process.env.SHOPIFY_APP_PROXY_PATH_PREFIX || "/apps/b2b-proxy"
).replace(/\/$/, "");

/**
 * Shopify forwards the full storefront path to the dev server. React Router routes
 * live at `/registration`, not `/apps/b2b-proxy/registration` — strip the prefix so
 * SSR and manifest generation match the browser after root.tsx path rewrite.
 */
function shopifyAppProxyDevPathRewrite(prefix: string): Plugin {
   return {
      name: "shopify-app-proxy-dev-path-rewrite",
      enforce: "pre",
      configureServer(server) {
         server.middlewares.use((req, _res, next) => {
            const raw = req.url;
            if (!raw) return next();
            const q = raw.indexOf("?");
            const pathOnly = q === -1 ? raw : raw.slice(0, q);
            const search = q === -1 ? "" : raw.slice(q);
            if (!pathOnly.startsWith(prefix)) return next();
            const tail = pathOnly.slice(prefix.length) || "/";
            const normalized = tail.startsWith("/") ? tail : `/${tail}`;
            req.url = normalized + search;
            next();
         });
      }
   };
}

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host, // This is for the browser to connect to
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    host: "127.0.0.1",
    allowedHosts: [host],
    // App proxy + AppProxyProvider load Vite modules from SHOPIFY_APP_URL while the
    // document stays on *.myshopify.com — browsers require CORS on those script responses.
    // preflightContinue alone does not emit Access-Control-Allow-Origin for GETs.
    cors: true,
    port: Number(process.env.PORT || 3000),
    hmr: host === "localhost" ? hmrConfig : {
      protocol: "wss",
      clientPort: 443,
      host: host,
    },
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [
    shopifyAppProxyDevPathRewrite(SHOPIFY_APP_PROXY_PATH_PREFIX),
    reactRouter(),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
}) satisfies UserConfig;
