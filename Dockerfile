FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public

ARG NEXT_PUBLIC_SUPABASE_URL=https://build-placeholder.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=build-placeholder-key
ARG NEXT_PUBLIC_DEFAULT_LANGUAGE=zh
ARG NEXT_PUBLIC_CLOUDBASE_ENV_ID=mornstudio-8gvvxjtpf4d99724
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
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
CMD ["node", "server.js"]