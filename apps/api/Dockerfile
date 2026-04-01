FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build --workspace @denga/shared
RUN npm run build --workspace @denga/api

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache postgresql16-client

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma/seed.ts ./prisma/seed.ts

EXPOSE 3001

CMD ["sh", "-c", "npx prisma db push && npm run prisma:seed && node apps/api/dist/main.js"]
