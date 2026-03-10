/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['localhost'],
  },
  env: {
    NEXT_PUBLIC_CLOUDBASE_ENV_ID:
      process.env.NEXT_PUBLIC_CLOUDBASE_ENV_ID ||
      process.env.NEXT_PUBLIC_WECHAT_CLOUDBASE_ID ||
      process.env.WECHAT_CLOUDBASE_ID ||
      '',
    NEXT_PUBLIC_CLOUDBASE_REGION:
      process.env.NEXT_PUBLIC_CLOUDBASE_REGION || process.env.CLOUDBASE_REGION || 'ap-shanghai',
    NEXT_PUBLIC_CLOUDBASE_ACCESS_KEY:
      process.env.NEXT_PUBLIC_CLOUDBASE_ACCESS_KEY ||
      process.env.NEXT_PUBLIC_CLOUDBASE_API_KEY ||
      process.env.CLOUDBASE_ACCESS_KEY ||
      '',
  },
}

module.exports = nextConfig 
