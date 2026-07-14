FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/contract/package.json ./packages/contract/
COPY packages/relay/package.json ./packages/relay/

RUN npm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/contract/ ./packages/contract/
COPY packages/relay/ ./packages/relay/

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/contract/dist ./packages/contract/dist
COPY --from=builder /app/packages/contract/package.json ./packages/contract/
COPY --from=builder /app/packages/relay/dist ./packages/relay/dist
COPY --from=builder /app/packages/relay/package.json ./packages/relay/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "packages/relay/dist/index.js"]
