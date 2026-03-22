import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,

  /**
   * ali-oss 保持外部化（避免 Turbopack 打包问题）。
   * 注意：不要在 Windows 上把 @prisma/client 放进 serverExternalPackages——Turbopack 会为其建 junction，
   * 常见报错：failed to create junction point … (os error 80 文件存在)，导致 /api/* 返回 HTML 500。
   */
  serverExternalPackages: ["ali-oss"],

  // Optimize for development memory usage
  experimental: {
    // Disable some features in dev to save memory
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
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
