# Single container: Fastify API + Socket.IO + the built web app (same origin).
# Requires a managed PostgreSQL (DATABASE_URL) and server-only keypair secrets via env.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
ARG VITE_SOLANA_CHAIN=solana:devnet
ENV VITE_SOLANA_CHAIN=$VITE_SOLANA_CHAIN
RUN npm run build --workspace @stake-arena/web

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
COPY --from=build /app /app
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
