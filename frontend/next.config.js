/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Use the Render deployment URL for your backend in production, fallback to localhost in dev
    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
      // FIX #9: Also proxy /health so api.ts health check works in dev
      {
        source: "/health",
        destination: `${backendUrl}/health`,
      },
    ];
  },
};

module.exports = nextConfig;
