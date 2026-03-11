# ========== 腾讯云云托管优化版 Dockerfile ==========
# 使用多阶段构建 + standalone 模式，适配 CloudBase 云托管

# ========== 阶段1: 依赖安装 ==========
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ========== 阶段2: 构建应用 ==========
FROM node:20-alpine AS builder
WORKDIR /app

# 复制依赖
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 构建时环境变量占位符，实际部署时由腾讯云环境变量覆盖
ARG NEXT_PUBLIC_SUPABASE_URL=https://build-placeholder.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=build-placeholder-key
ARG NEXT_PUBLIC_DEFAULT_LANGUAGE=en
ARG NEXT_PUBLIC_CLOUDBASE_ENV_ID=build-placeholder-env-id
ARG NEXT_PUBLIC_CLOUDBASE_REGION=ap-shanghai
ARG NEXT_PUBLIC_CLOUDBASE_ACCESS_KEY=build-placeholder-access-key
ARG ADMIN_SESSION_SECRET=build-placeholder-admin-session-secret

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_DEFAULT_LANGUAGE=$NEXT_PUBLIC_DEFAULT_LANGUAGE
ENV NEXT_PUBLIC_CLOUDBASE_ENV_ID=$NEXT_PUBLIC_CLOUDBASE_ENV_ID
ENV NEXT_PUBLIC_CLOUDBASE_REGION=$NEXT_PUBLIC_CLOUDBASE_REGION
ENV NEXT_PUBLIC_CLOUDBASE_ACCESS_KEY=$NEXT_PUBLIC_CLOUDBASE_ACCESS_KEY
ENV ADMIN_SESSION_SECRET=$ADMIN_SESSION_SECRET

# 构建 standalone 输出
RUN npm run build

# ========== 阶段3: 生产运行 ==========
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 复制 standalone 输出
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 设置文件权限
RUN chown -R nextjs:nodejs /app
USER nextjs

# 腾讯云云托管会把外部流量转发到容器端口
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

# standalone 模式使用 server.js 启动
CMD ["node", "server.js"]
