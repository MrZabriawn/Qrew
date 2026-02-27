/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React Strict Mode for additional runtime warnings during development
  // (double-invokes effects and renders to detect side-effect bugs).
  reactStrictMode: true,

  // Export the app as a fully static HTML/CSS/JS bundle suitable for Firebase Hosting.
  // With `output: 'export'`, Next.js generates an `out/` directory that can be deployed
  // directly — no Node.js server required. This means no server-side rendering (SSR) or
  // API routes; all data fetching happens client-side via Firebase SDK calls.
  output: 'export',

  images: {
    // The built-in Next.js Image Optimization API requires a server.
    // Since we're using static export, disable optimization so <Image> components
    // still render as plain <img> tags without triggering a server requirement.
    unoptimized: true
  }
}

module.exports = nextConfig
