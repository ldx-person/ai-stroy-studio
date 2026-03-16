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
    // Mark ali-oss as server-only external to avoid Turbopack bundling issues
    serverComponentsExternalPackages: ['ali-oss'],
  },
  
  // Add empty turbopack config to silence warning
  turbopack: {},
  
  // Webpack fallback for ali-oss (node-specific modules)
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ensure ali-oss is treated as external in webpack builds
      config.externals = [...(config.externals || []), 'ali-oss'];
    }
    return config;
  },
};

export default nextConfig;
