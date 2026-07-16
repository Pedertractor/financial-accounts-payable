FROM node:22-alpine AS build

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm set strict-ssl false
ENV NODE_TLS_REJECT_UNAUTHORIZED=0
RUN npm install

# prisma.config.ts exige DATABASE_URL ao carregar; .env não entra no build (.dockerignore)
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build

COPY . .

RUN npm run build

FROM node:22-alpine

WORKDIR /usr/src/app

RUN npm set strict-ssl false
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/prisma ./prisma
COPY --from=build /usr/src/app/package*.json ./
COPY --from=build /usr/src/app/prisma.config.ts ./prisma.config.ts
# Seed roda com tsx e importa integrações em src/ (a API em produção usa só dist/).
COPY --from=build /usr/src/app/src ./src

# porta padrão do app (override via PORT no .env / compose)
EXPOSE 3030

# prisma generate atualiza src/generated; seed é idempotente (pula ADMs já existentes).
CMD ["sh", "-c", "npx prisma generate && npx prisma migrate deploy && npx prisma db seed && npm run start"]