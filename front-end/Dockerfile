FROM node:20-alpine AS builder

WORKDIR /app

# Instala dependências
COPY package*.json ./

RUN npm set strict-ssl false
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

RUN npm install

# Copia o projeto
COPY . .

# URL da API usada no browser (bake no build do Vite)
ARG VITE_API_BASE_URL=http://localhost:3030/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Build da aplicação
RUN npm run build

# --- Serve with NGINX ---
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# copia sua configuração customizada
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]