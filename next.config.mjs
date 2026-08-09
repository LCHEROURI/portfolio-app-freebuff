/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Serverless PDF rendering (/api/print/pdf): @sparticuz/chromium resolves
  // its binary via relative paths, so it must stay EXTERNAL to the server
  // bundle (Next 14 key), and its bin/ directory must be traced into the
  // /api/print/pdf function so the headless shell ships to the read-only
  // serverless filesystem — otherwise the route 503s with no Chrome.
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium'],
  },
  outputFileTracingIncludes: {
    '/api/print/pdf': ['node_modules/@sparticuz/chromium/bin/**'],
  },
};

export default nextConfig;
