import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  
  // Optimize for development memory usage
  experimental: {
    // Disable some features in dev to save memory
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
  
  // Add empty turbopack config to silence warning
  turbopack: {},
};

export default nextConfig;
