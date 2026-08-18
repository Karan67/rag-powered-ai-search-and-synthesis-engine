/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow cross-origin requests to the FastAPI backend during development
  async rewrites() {
    return [];
  },
  // Expose runtime environment variables to both server and client
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000",
  },
  // Disable x-powered-by header for security
  poweredByHeader: false,
  // Strict mode for React
  reactStrictMode: true,
};

export default nextConfig;
